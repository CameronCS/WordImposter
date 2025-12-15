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

    // Leave room
    socket.on('leaveRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            
            // Delete room if empty
            if (room.players.length === 0) {
                rooms.delete(roomCode);
                console.log(`Room ${roomCode} deleted (empty)`);
            } else {
                // If host left, assign new host
                if (room.host === socket.id) {
                    room.host = room.players[0].id;
                    room.players[0].isHost = true;
                }
                io.to(roomCode).emit('playerLeft', { players: room.players });
            }
            
            socket.leave(roomCode);
        }
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

        // Send game started event with word assignments
        room.players.forEach((player, index) => {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                playerSocket.emit('gameStarted', {
                    word: index === room.imposterIndex ? room.imposterWord : room.word,
                    isImposter: index === room.imposterIndex,
                    currentRound: room.currentRound,
                    maxRounds: room.maxRounds,
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

        // Move to next turn
        room.currentTurn++;
        
        // Skip eliminated players
        while (room.currentTurn < room.turnOrder.length && room.players[room.turnOrder[room.currentTurn]].eliminated) {
            room.currentTurn++;
        }

        if (room.currentTurn >= room.turnOrder.length) {
            // All players have described, start voting
            console.log('All players done, starting voting');
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
        }
    });

    // Submit vote
    socket.on('submitVote', ({ roomCode, votedPlayerId }) => {
        const room = rooms.get(roomCode);
        if (!room || !room.votingPhase) return;

        // Check if voter is eliminated
        const voter = room.players.find(p => p.id === socket.id);
        if (voter && voter.eliminated) {
            console.log('Eliminated player tried to vote');
            return;
        }

        // Allow skip votes but don't count them towards anyone
        room.votes.set(socket.id, votedPlayerId);
        
        // Broadcast that this player has voted (for checkmark display)
        io.to(roomCode).emit('playerVoted', { playerId: socket.id });

        // Check if all non-eliminated players have voted
        const activePlayersCount = room.players.filter(p => !p.eliminated).length;
        if (room.votes.size === activePlayersCount) {
            // Count votes (ignore SKIP_VOTE)
            const voteCounts = new Map();
            room.votes.forEach((votedId) => {
                if (votedId !== 'SKIP_VOTE') {
                    voteCounts.set(votedId, (voteCounts.get(votedId) || 0) + 1);
                }
            });

            // Find player with most votes
            let maxVotes = 0;
            let votedOutPlayerId = null;
            voteCounts.forEach((count, playerId) => {
                if (count > maxVotes) {
                    maxVotes = count;
                    votedOutPlayerId = playerId;
                }
            });

            // If no one was voted (all skipped or tie at 0), skip elimination
            if (!votedOutPlayerId || maxVotes === 0) {
                console.log('No clear vote - skipping elimination');
                
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
                    votedOut: 'No one (votes skipped)',
                    currentTurnPlayer: room.players[nextPlayerIndex].nickname,
                    players: room.players
                });
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
                    votedOut: votedOutPlayer.nickname,
                    currentTurnPlayer: room.players[nextPlayerIndex].nickname,
                    players: room.players
                });
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