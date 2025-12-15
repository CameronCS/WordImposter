const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Word pairs - crew gets first word, imposter gets opposite
const WORD_PAIRS = {
    'Hot': 'Cold',
    'Day': 'Night',
    'Sun': 'Moon',
    'Fire': 'Ice',
    'Up': 'Down',
    'Left': 'Right',
    'Big': 'Small',
    'Fast': 'Slow',
    'Loud': 'Quiet',
    'Happy': 'Sad',
    'Light': 'Dark',
    'Heaven': 'Hell',
    'Angel': 'Devil',
    'Hero': 'Villain',
    'Doctor': 'Patient',
    'Teacher': 'Student',
    'King': 'Queen',
    'Land': 'Sea',
    'Summer': 'Winter',
    'Spring': 'Autumn',
    'Sweet': 'Sour',
    'Smooth': 'Rough',
    'Hard': 'Soft',
    'Rich': 'Poor',
    'Young': 'Old',
    'New': 'Old',
    'Clean': 'Dirty',
    'Empty': 'Full',
    'Tall': 'Short',
    'Wide': 'Narrow',
    'Thick': 'Thin',
    'Strong': 'Weak',
    'Heavy': 'Light',
    'Sharp': 'Dull',
    'Wet': 'Dry',
    'Open': 'Closed',
    'Start': 'End',
    'Love': 'Hate',
    'Peace': 'War',
    'Life': 'Death'
};

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
            gameStarted: false,
            currentRound: 0,
            maxRounds: 3,
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
        socket.emit('roomJoined', { roomCode, players: room.players });
        
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
                descriptions: room.descriptions
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

        room.votes.set(socket.id, votedPlayerId);

        // Check if all non-eliminated players have voted
        const activePlayersCount = room.players.filter(p => !p.eliminated).length;
        if (room.votes.size === activePlayersCount) {
            // Count votes
            const voteCounts = new Map();
            room.votes.forEach((votedId) => {
                voteCounts.set(votedId, (voteCounts.get(votedId) || 0) + 1);
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

            const votedOutPlayer = room.players.find(p => p.id === votedOutPlayerId);
            const votedOutIndex = room.players.findIndex(p => p.id === votedOutPlayerId);
            const isImposter = votedOutIndex === room.imposterIndex;

            // Mark player as eliminated
            if (votedOutPlayer) {
                votedOutPlayer.eliminated = true;
            }

            if (isImposter) {
                // Crew wins
                io.to(roomCode).emit('gameOver', {
                    winner: 'crew',
                    imposter: room.players[room.imposterIndex].nickname,
                    crewWord: room.word,
                    imposterWord: room.imposterWord,
                    votedOut: votedOutPlayer.nickname
                });
                // Reset room
                room.gameStarted = false;
                // Reset eliminated status and ready status for all players
                room.players.forEach(p => {
                    p.eliminated = false;
                    p.ready = p.isHost ? false : false; // Reset ready state
                });
            } else if (room.currentRound >= room.maxRounds) {
                // Imposter wins - ran out of rounds
                io.to(roomCode).emit('gameOver', {
                    winner: 'imposter',
                    imposter: room.players[room.imposterIndex].nickname,
                    crewWord: room.word,
                    imposterWord: room.imposterWord,
                    votedOut: votedOutPlayer.nickname
                });
                // Reset room
                room.gameStarted = false;
                // Reset eliminated status and ready status for all players
                room.players.forEach(p => {
                    p.eliminated = false;
                    p.ready = p.isHost ? false : false;
                });
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