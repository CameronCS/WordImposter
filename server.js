const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Load word pairs from JSON file
let WORD_PAIRS = {};
try {
    const wordsData = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
    WORD_PAIRS = JSON.parse(wordsData);
    console.log(`Loaded ${Object.keys(WORD_PAIRS).length} word pairs`);
} catch (error) {
    console.error('Error loading words.json:', error);
    // Fallback word pairs
    WORD_PAIRS = {
        'Hot': 'Cold',
        'Day': 'Night',
        'Sun': 'Moon',
        'Fire': 'Ice',
        'Up': 'Down'
    };
}

// Track used words in this session
const usedWords = new Set();

// Game state
const rooms = new Map();

// Generate random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Get random word that hasn't been used recently
function getRandomWord() {
    const availableWords = Object.keys(WORD_PAIRS).filter(word => !usedWords.has(word));
    
    // If we've used all words, reset
    if (availableWords.length === 0) {
        usedWords.clear();
        return Object.keys(WORD_PAIRS)[Math.floor(Math.random() * Object.keys(WORD_PAIRS).length)];
    }
    
    const word = availableWords[Math.floor(Math.random() * availableWords.length)];
    usedWords.add(word);
    return word;
}

// Get opposite word for imposter
function getOppositeWord(word) {
    return WORD_PAIRS[word];
}

// Get random imposter index
function getRandomImposterIndex(playerCount) {
    return Math.floor(Math.random() * playerCount);
}

// Start turn timer
function startTurnTimer(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Clear existing timer
    if (room.turnTimer) {
        clearInterval(room.turnTimer);
    }

    let timeLeft = room.turnDuration;
    
    room.turnTimer = setInterval(() => {
        timeLeft--;
        
        // Send timer update to all players
        io.to(roomCode).emit('turnTimerUpdate', { timeLeft });
        
        if (timeLeft <= 0) {
            clearInterval(room.turnTimer);
            
            // Auto-submit empty description if time runs out
            const currentTurnPlayerIndex = room.turnOrder[room.currentTurn];
            room.descriptions.push({
                player: room.players[currentTurnPlayerIndex].nickname,
                description: '[Time ran out]'
            });

            // Move to next turn
            room.currentTurn++;
            
            // Skip eliminated players
            while (room.currentTurn < room.turnOrder.length && room.players[room.turnOrder[room.currentTurn]].eliminated) {
                room.currentTurn++;
            }

            if (room.currentTurn >= room.turnOrder.length) {
                // All players done, start voting
                clearInterval(room.turnTimer); // Clear timer during voting
                room.votingPhase = true;
                const votablePlayers = room.players.filter(p => !p.eliminated);
                
                io.to(roomCode).emit('startVoting', {
                    descriptions: room.descriptions,
                    players: votablePlayers
                });
            } else {
                // Next player's turn
                const nextPlayerIndex = room.turnOrder[room.currentTurn];
                io.to(roomCode).emit('nextTurn', {
                    currentTurnPlayer: room.players[nextPlayerIndex].nickname,
                    descriptions: room.descriptions,
                    players: room.players
                });
                
                // Start timer for next turn
                startTurnTimer(roomCode);
            }
        }
    }, 1000);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create room
    socket.on('createRoom', (nickname) => {
        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            host: socket.id,
            players: [{
                id: socket.id,
                nickname: nickname,
                isHost: true,
                eliminated: false,
                ready: false
            }],
            chatMessages: [],
            kickVotes: new Map(), // Track kick votes
            turnTimer: null, // Turn timer
            turnDuration: 60, // 60 seconds per turn
            gameStarted: false,
            isPrivate: false,
            currentRound: 0,
            maxRounds: 3,
            minPlayersForImposterWin: 2,
            currentTurn: 0,
            turnOrder: [],
            word: null,
            imposterWord: null,
            imposterIndex: null,
            descriptions: [],
            votes: new Map(),
            votingPhase: false
        };
        
        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: room.players });
    });

    // Join room
    socket.on('joinRoom', ({ roomCode, nickname }) => {
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        if (room.gameStarted) {
            socket.emit('error', 'Game already in progress');
            return;
        }

        const player = {
            id: socket.id,
            nickname: nickname,
            isHost: false,
            eliminated: false,
            ready: false
        };

        room.players.push(player);
        socket.join(roomCode);
        
        // Send room joined confirmation to the joining player
        socket.emit('roomJoined', { roomCode, players: room.players, chatMessages: room.chatMessages });
        
        // Notify everyone else
        io.to(roomCode).emit('playerJoined', { players: room.players });
    });

    // Ready check
    socket.on('toggleReady', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room || room.gameStarted) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.isHost) return; // Host doesn't ready up

        player.ready = !player.ready;
        io.to(roomCode).emit('playerReadyUpdate', { players: room.players });
    });

    // Lobby chat
    socket.on('lobbyChatMessage', ({ roomCode, message }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const chatMessage = {
            player: player.nickname,
            message: message,
            timestamp: Date.now()
        };

        room.chatMessages.push(chatMessage);
        
        // Keep only last 50 messages
        if (room.chatMessages.length > 50) {
            room.chatMessages.shift();
        }

        io.to(roomCode).emit('lobbyChatMessage', chatMessage);
    });

    // Update room settings (host only)
    socket.on('updateRoomSettings', ({ roomCode, maxRounds, minPlayersForImposterWin, isPrivate }) => {
        const room = rooms.get(roomCode);
        if (!room || room.host !== socket.id || room.gameStarted) return;

        if (maxRounds !== undefined) {
            room.maxRounds = Math.max(1, Math.min(10, maxRounds)); // 1-10 rounds
        }
        
        if (minPlayersForImposterWin !== undefined) {
            room.minPlayersForImposterWin = Math.max(1, Math.min(5, minPlayersForImposterWin)); // 1-5 players
        }
        
        if (isPrivate !== undefined) {
            room.isPrivate = isPrivate;
        }

        io.to(roomCode).emit('roomSettingsUpdated', { 
            maxRounds: room.maxRounds,
            minPlayersForImposterWin: room.minPlayersForImposterWin,
            isPrivate: room.isPrivate 
        });
    });

    // Get public lobbies
    socket.on('getPublicLobbies', () => {
        const publicLobbies = [];
        rooms.forEach((room, code) => {
            if (!room.isPrivate && !room.gameStarted) {
                publicLobbies.push({
                    code: room.code,
                    playerCount: room.players.length,
                    maxRounds: room.maxRounds
                });
            }
        });
        socket.emit('publicLobbies', publicLobbies);
    });

    // Vote kick system (works in lobby and during game)
    socket.on('voteKick', ({ roomCode, targetPlayerId }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const voter = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === targetPlayerId);
        
        if (!voter || !target || target.isHost) return;

        // Initialize kick votes for this target if not exists
        if (!room.kickVotes.has(targetPlayerId)) {
            room.kickVotes.set(targetPlayerId, new Set());
        }

        // Add vote
        room.kickVotes.get(targetPlayerId).add(socket.id);
        
        const votesNeeded = Math.ceil(room.players.length / 2); // Majority needed
        const currentVotes = room.kickVotes.get(targetPlayerId).size;
        
        console.log(`Kick votes for ${target.nickname}: ${currentVotes}/${votesNeeded}`);

        // Check if majority reached
        if (currentVotes >= votesNeeded) {
            // Kick the player
            const targetSocket = io.sockets.sockets.get(targetPlayerId);
            if (targetSocket) {
                targetSocket.emit('kicked', 'You were vote-kicked');
                targetSocket.leave(roomCode);
            }

            // Remove from room
            const targetIndex = room.players.findIndex(p => p.id === targetPlayerId);
            if (targetIndex !== -1) {
                room.players.splice(targetIndex, 1);
            }

            // Clear kick votes
            room.kickVotes.delete(targetPlayerId);

            // Notify remaining players
            io.to(roomCode).emit('playerKicked', { 
                kickedPlayer: target.nickname,
                players: room.players 
            });
            
            // If game is active and this affects gameplay
            if (room.gameStarted) {
                // Check if game should continue
                if (room.players.length < 3) {
                    // Not enough players, end game
                    clearInterval(room.turnTimer);
                    io.to(roomCode).emit('gameEnded', { reason: 'Not enough players' });
                    room.gameStarted = false;
                }
            }
        } else {
            // Notify voter
            socket.emit('kickVoteRecorded', { 
                target: target.nickname, 
                votes: currentVotes, 
                needed: votesNeeded 
            });
        }
    });

    // Leave room
    socket.on('leaveRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;

        const wasHost = room.host === socket.id;
        
        // Remove player
        room.players.splice(playerIndex, 1);
        
        // Delete room if empty
        if (room.players.length === 0) {
            rooms.delete(roomCode);
            console.log(`Room ${roomCode} deleted (empty)`);
        } else {
            // If host left, assign new host (first player in list)
            if (wasHost) {
                room.host = room.players[0].id;
                room.players[0].isHost = true;
                console.log(`Room ${roomCode}: Host transferred to ${room.players[0].nickname}`);
                
                // Notify all players of new host
                io.to(roomCode).emit('hostChanged', { 
                    newHost: room.players[0].nickname,
                    players: room.players 
                });
            } else {
                // Just notify players someone left
                io.to(roomCode).emit('playerLeft', { players: room.players });
            }
        }
        
        socket.leave(roomCode);
    });

    // Start game
    socket.on('startGame', (roomCode) => {
        const room = rooms.get(roomCode);
        
        if (!room || room.host !== socket.id) {
            return;
        }

        if (room.players.length < 3) {
            socket.emit('error', 'Need at least 3 players to start');
            return;
        }

        // Check if all non-host players are ready
        const nonHostPlayers = room.players.filter(p => !p.isHost);
        const allReady = nonHostPlayers.every(p => p.ready);
        
        if (!allReady && nonHostPlayers.length > 0) {
            socket.emit('error', 'All players must be ready');
            return;
        }

        // Start the game
        room.gameStarted = true;
        room.currentRound = 1;
        
        // Reset all player states for new game
        console.log('=== STARTING NEW GAME ===');
        console.log('Players BEFORE reset:', room.players.map(p => ({ name: p.nickname, eliminated: p.eliminated })));
        
        room.players.forEach(p => {
            p.eliminated = false;
            p.ready = false;
        });
        
        console.log('Players AFTER reset:', room.players.map(p => ({ name: p.nickname, eliminated: p.eliminated })));
        
        // Randomize turn order
        room.turnOrder = [...Array(room.players.length).keys()]; // [0, 1, 2, 3, ...]
        room.turnOrder.sort(() => Math.random() - 0.5); // Shuffle
        room.currentTurn = 0;
        
        room.word = getRandomWord();
        room.imposterWord = getOppositeWord(room.word);
        room.imposterIndex = getRandomImposterIndex(room.players.length);
        room.descriptions = [];
        room.votes = new Map();
        room.votingPhase = false;

        // Start turn timer
        startTurnTimer(roomCode);

        // Send game started event with word assignments
        room.players.forEach((player, index) => {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                // Don't tell imposter they're the imposter!
                playerSocket.emit('gameStarted', {
                    word: index === room.imposterIndex ? room.imposterWord : room.word,
                    isImposter: false, // Never tell anyone they're imposter
                    currentRound: room.currentRound,
                    maxRounds: room.maxRounds,
                    minPlayers: room.minPlayersForImposterWin,
                    players: room.players,
                    currentTurnPlayer: room.players[room.turnOrder[0]].nickname
                });
            }
        });
    });

    // Submit description
    socket.on('submitDescription', ({ roomCode, description }) => {
        console.log('=== submitDescription called ===');
        console.log('Socket ID:', socket.id);
        console.log('Room code received:', roomCode);
        console.log('Description:', description);
        console.log('Available rooms:', Array.from(rooms.keys()));
        
        const room = rooms.get(roomCode);
        
        if (!room) {
            console.log('ERROR: Room not found!');
            socket.emit('error', 'Room not found');
            return;
        }
        
        if (!room.gameStarted) {
            console.log('ERROR: Game not started!');
            console.log('Room state:', { gameStarted: room.gameStarted, players: room.players.length });
            socket.emit('error', 'Game not started');
            return;
        }

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        const currentTurnPlayerIndex = room.turnOrder[room.currentTurn];
        
        console.log(`Player ${socket.id} (index ${playerIndex}) submitting, current turn index in turnOrder: ${room.currentTurn}, actual player index: ${currentTurnPlayerIndex}`);
        
        if (playerIndex !== currentTurnPlayerIndex) {
            console.log('ERROR: Not this player\'s turn');
            return;
        }

        room.descriptions.push({
            player: room.players[playerIndex].nickname,
            description: description
        });

        console.log(`Description added. Total descriptions: ${room.descriptions.length}`);

        // Clear turn timer
        if (room.turnTimer) {
            clearInterval(room.turnTimer);
        }

        // Move to next turn
        room.currentTurn++;
        
        // Skip eliminated players
        while (room.currentTurn < room.turnOrder.length && room.players[room.turnOrder[room.currentTurn]].eliminated) {
            room.currentTurn++;
        }

        if (room.currentTurn >= room.turnOrder.length) {
            // All players have described, start voting
            console.log('All players done, starting voting');
            console.log('Players state at voting:', room.players.map(p => ({ name: p.nickname, eliminated: p.eliminated })));
            clearInterval(room.turnTimer); // Clear timer during voting
            room.votingPhase = true;
            
            // Only send non-eliminated players for voting
            const votablePlayers = room.players.filter(p => !p.eliminated);
            
            io.to(roomCode).emit('startVoting', {
                descriptions: room.descriptions,
                players: votablePlayers
            });
        } else {
            // Next player's turn
            const nextPlayerIndex = room.turnOrder[room.currentTurn];
            console.log(`Next turn: ${room.players[nextPlayerIndex].nickname}`);
            io.to(roomCode).emit('nextTurn', {
                currentTurnPlayer: room.players[nextPlayerIndex].nickname,
                descriptions: room.descriptions,
                players: room.players
            });
            
            // Start timer for next turn
            startTurnTimer(roomCode);
        }
    });

    // Submit vote
    socket.on('submitVote', ({ roomCode, votedPlayerId }) => {
        const room = rooms.get(roomCode);
        if (!room || !room.votingPhase) return;

        // Check if voter is eliminated
        const voter = room.players.find(p => p.id === socket.id);
        console.log(`Vote from ${voter?.nickname}: eliminated=${voter?.eliminated}`);
        
        if (voter && voter.eliminated) {
            console.log(`BLOCKED: ${voter.nickname} tried to vote but is eliminated!`);
            return;
        }

        // Allow skip votes but don't count them towards anyone
        room.votes.set(socket.id, votedPlayerId);
        
        // Broadcast that this player has voted (for checkmark display)
        io.to(roomCode).emit('playerVoted', { playerId: socket.id });

        // Check if all non-eliminated players have voted
        const activePlayersCount = room.players.filter(p => !p.eliminated).length;
        if (room.votes.size === activePlayersCount) {
            // Count ALL votes including SKIP_VOTE
            const voteCounts = new Map();
            room.votes.forEach((votedId) => {
                voteCounts.set(votedId, (voteCounts.get(votedId) || 0) + 1);
            });

            console.log('Vote counts:', Object.fromEntries(voteCounts));

            // Find the option(s) with most votes
            let maxVotes = 0;
            const winners = [];
            
            voteCounts.forEach((count, target) => {
                if (count > maxVotes) {
                    maxVotes = count;
                    winners.length = 0; // Clear previous winners
                    winners.push(target);
                } else if (count === maxVotes) {
                    winners.push(target); // Add to tie
                }
            });

            // If tie (multiple winners) OR skip won, treat as skip
            let votedOutPlayerId = null;
            
            if (winners.length > 1) {
                // Tie - treat as skip
                console.log('Tie detected - treating as skip');
                votedOutPlayerId = null;
            } else if (winners.length === 1 && winners[0] === 'SKIP_VOTE') {
                // Skip won
                console.log('Skip vote won');
                votedOutPlayerId = null;
            } else if (winners.length === 1) {
                // Clear winner
                votedOutPlayerId = winners[0];
                console.log(`Player ${votedOutPlayerId} voted out with ${maxVotes} votes`);
            } else {
                // No votes at all (shouldn't happen but handle gracefully)
                votedOutPlayerId = null;
            }

            // If no one was voted out (skip/tie), skip elimination
            if (!votedOutPlayerId) {
                console.log('No elimination this round');
                
                // Check if this is the last round
                if (room.currentRound >= room.maxRounds) {
                    // Imposter wins - crew failed to identify
                    room.players.forEach(p => {
                        p.eliminated = false;
                        p.ready = false;
                    });
                    
                    io.to(roomCode).emit('gameOver', {
                        winner: 'imposter',
                        imposter: room.players[room.imposterIndex].nickname,
                        crewWord: room.word,
                        imposterWord: room.imposterWord,
                        votedOut: 'No one (votes skipped)',
                        players: room.players
                    });
                    
                    room.gameStarted = false;
                    return;
                }
                
                // Next round without elimination
                room.currentRound++;
                
                // Clear any existing timer
                if (room.turnTimer) {
                    clearInterval(room.turnTimer);
                }
                
                // Re-shuffle turn order for new round
                room.turnOrder = [...Array(room.players.length).keys()];
                room.turnOrder.sort(() => Math.random() - 0.5);
                room.currentTurn = 0;
                
                // Skip eliminated players for first turn
                while (room.currentTurn < room.turnOrder.length && room.players[room.turnOrder[room.currentTurn]].eliminated) {
                    room.currentTurn++;
                }
                
                room.descriptions = [];
                room.votes = new Map();
                room.votingPhase = false;

                const nextPlayerIndex = room.turnOrder[room.currentTurn];
                io.to(roomCode).emit('nextRound', {
                    currentRound: room.currentRound,
                    maxRounds: room.maxRounds,
                    minPlayers: room.minPlayersForImposterWin,
                    votedOut: 'No one (votes skipped)',
                    currentTurnPlayer: room.players[nextPlayerIndex].nickname,
                    players: room.players
                });
                
                // Start timer for new round
                startTurnTimer(roomCode);
                return;
            }

            const votedOutPlayer = room.players.find(p => p.id === votedOutPlayerId);
            const votedOutIndex = room.players.findIndex(p => p.id === votedOutPlayerId);
            const isImposter = votedOutIndex === room.imposterIndex;

            // Mark player as eliminated
            if (votedOutPlayer) {
                votedOutPlayer.eliminated = true;
            }

            // Check if imposter wins by numbers (based on minPlayers setting)
            const activeNonImposterCount = room.players.filter((p, idx) => !p.eliminated && idx !== room.imposterIndex).length;
            const imposterAlive = !room.players[room.imposterIndex].eliminated;
            
            if (imposterAlive && activeNonImposterCount <= room.minPlayersForImposterWin) {
                // Imposter wins - crew reduced to minimum threshold
                room.players.forEach(p => {
                    p.eliminated = false;
                    p.ready = false;
                });
                
                io.to(roomCode).emit('gameOver', {
                    winner: 'imposter',
                    imposter: room.players[room.imposterIndex].nickname,
                    crewWord: room.word,
                    imposterWord: room.imposterWord,
                    votedOut: votedOutPlayer.nickname,
                    reason: `Crew reduced to ${activeNonImposterCount} - Imposter wins!`,
                    players: room.players
                });
                
                room.gameStarted = false;
                return;
            }

            if (isImposter) {
                // Crew wins
                // Reset ready status first
                room.players.forEach(p => {
                    p.eliminated = false;
                    p.ready = false;
                });
                
                io.to(roomCode).emit('gameOver', {
                    winner: 'crew',
                    imposter: room.players[room.imposterIndex].nickname,
                    crewWord: room.word,
                    imposterWord: room.imposterWord,
                    votedOut: votedOutPlayer.nickname,
                    players: room.players
                });
                
                // Reset room
                room.gameStarted = false;
            } else if (room.currentRound >= room.maxRounds) {
                // Imposter wins - ran out of rounds
                // Reset ready status first
                room.players.forEach(p => {
                    p.eliminated = false;
                    p.ready = false;
                });
                
                io.to(roomCode).emit('gameOver', {
                    winner: 'imposter',
                    imposter: room.players[room.imposterIndex].nickname,
                    crewWord: room.word,
                    imposterWord: room.imposterWord,
                    votedOut: votedOutPlayer.nickname,
                    players: room.players
                });
                
                // Reset room
                room.gameStarted = false;
            } else {
                // Next round - randomize turn order again
                room.currentRound++;
                
                // Re-shuffle turn order for new round
                room.turnOrder = [...Array(room.players.length).keys()];
                room.turnOrder.sort(() => Math.random() - 0.5);
                room.currentTurn = 0;
                
                // Skip eliminated players for first turn
                while (room.currentTurn < room.turnOrder.length && room.players[room.turnOrder[room.currentTurn]].eliminated) {
                    room.currentTurn++;
                }
                
                room.descriptions = [];
                room.votes = new Map();
                room.votingPhase = false;

                const nextPlayerIndex = room.turnOrder[room.currentTurn];
                io.to(roomCode).emit('nextRound', {
                    currentRound: room.currentRound,
                    maxRounds: room.maxRounds,
                    minPlayers: room.minPlayersForImposterWin,
                    votedOut: votedOutPlayer.nickname,
                    currentTurnPlayer: room.players[nextPlayerIndex].nickname,
                    players: room.players
                });
                
                // Start timer for new round
                startTurnTimer(roomCode);
            }
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove player from rooms
        rooms.forEach((room, code) => {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                
                if (room.players.length === 0) {
                    rooms.delete(code);
                } else {
                    // If host left, assign new host
                    if (room.host === socket.id && room.players.length > 0) {
                        room.host = room.players[0].id;
                        room.players[0].isHost = true;
                    }
                    io.to(code).emit('playerLeft', { players: room.players });
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});