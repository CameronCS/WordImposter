const socket = io();

// Game state
let currentRoom = null;
let currentPlayer = null;
let isHost = false;
let myWord = null;
let isImposter = false;
let selectedVote = null;
let isEliminated = false;

// DOM elements
const screens = {
    home: document.getElementById('homeScreen'),
    join: document.getElementById('joinScreen'),
    lobby: document.getElementById('lobbyScreen'),
    game: document.getElementById('gameScreen'),
    voting: document.getElementById('votingScreen'),
    gameOver: document.getElementById('gameOverScreen')
};

// Utility functions
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenName].classList.add('active');
}

function showError(message) {
    const toast = document.getElementById('errorToast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Validate 2-word limit
function validateDescription(text) {
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    return words.length <= 2;
}

// Home screen
document.getElementById('createRoomBtn').addEventListener('click', () => {
    const nickname = document.getElementById('nicknameInput').value.trim();
    if (!nickname) {
        showError('Please enter a nickname');
        return;
    }
    currentPlayer = nickname;
    isHost = true;
    socket.emit('createRoom', nickname);
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const nickname = document.getElementById('nicknameInput').value.trim();
    if (!nickname) {
        showError('Please enter a nickname');
        return;
    }
    currentPlayer = nickname;
    showScreen('join');
});

// Join screen
document.getElementById('joinGameBtn').addEventListener('click', () => {
    const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (!roomCode) {
        showError('Please enter a room code');
        return;
    }
    currentRoom = roomCode;
    socket.emit('joinRoom', { roomCode, nickname: currentPlayer });
});

document.getElementById('backToHomeBtn').addEventListener('click', () => {
    showScreen('home');
});

// Lobby screen - Ready button
const readyBtn = document.getElementById('readyBtn');
if (readyBtn) {
    readyBtn.addEventListener('click', () => {
        socket.emit('toggleReady', currentRoom);
    });
}

// Lobby chat
const lobbyChatSend = document.getElementById('lobbyChatSend');
const lobbyChatInput = document.getElementById('lobbyChatInput');

if (lobbyChatSend) {
    lobbyChatSend.addEventListener('click', () => {
        sendLobbyChat();
    });
}

if (lobbyChatInput) {
    lobbyChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendLobbyChat();
        }
    });
}

function sendLobbyChat() {
    const message = lobbyChatInput.value.trim();
    if (!message || !currentRoom) return;
    
    socket.emit('lobbyChatMessage', { roomCode: currentRoom, message });
    lobbyChatInput.value = '';
}

function addChatMessage(chatMessage) {
    const chatMessages = document.getElementById('lobbyChatMessages');
    if (!chatMessages) return;
    
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `
        <div class="chat-message-player">${chatMessage.player}</div>
        <div class="chat-message-text">${chatMessage.message}</div>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Lobby screen - Start game
document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('startGame', currentRoom);
});

// Game screen - Submit with validation
document.getElementById('submitDescriptionBtn').addEventListener('click', () => {
    const description = document.getElementById('descriptionText').value.trim();
    
    if (!description) {
        showError('Please enter a description');
        return;
    }
    
    if (!validateDescription(description)) {
        showError('Maximum 2 words allowed!');
        return;
    }
    
    socket.emit('submitDescription', { roomCode: currentRoom, description });
    document.getElementById('descriptionText').value = '';
    document.getElementById('descriptionInput').style.display = 'none';
});

// Voting screen - Skip vote button
const skipVoteBtn = document.getElementById('skipVoteBtn');
if (skipVoteBtn) {
    skipVoteBtn.addEventListener('click', () => {
        // Vote for a special "skip" ID
        socket.emit('submitVote', { roomCode: currentRoom, votedPlayerId: 'SKIP_VOTE' });
        skipVoteBtn.disabled = true;
        skipVoteBtn.textContent = 'Vote Skipped';
    });
}

// Game over screen
document.getElementById('backToLobbyBtn').addEventListener('click', () => {
    showScreen('lobby');
    myWord = null;
    isImposter = false;
    selectedVote = null;
    isEliminated = false;
    document.getElementById('descriptionsList').innerHTML = '';
});

// Socket event handlers
socket.on('roomCreated', ({ roomCode, players }) => {
    currentRoom = roomCode;
    document.getElementById('displayRoomCode').textContent = roomCode;
    updatePlayersList(players);
    showScreen('lobby');
    document.getElementById('startGameBtn').style.display = 'block';
    document.getElementById('readyBtn').style.display = 'none';
    document.getElementById('waitingText').style.display = 'none';
});

socket.on('roomJoined', ({ roomCode, players, chatMessages }) => {
    currentRoom = roomCode;
    document.getElementById('displayRoomCode').textContent = roomCode;
    updatePlayersList(players);
    
    // Load chat history
    if (chatMessages) {
        const chatMessagesDiv = document.getElementById('lobbyChatMessages');
        if (chatMessagesDiv) {
            chatMessagesDiv.innerHTML = '';
            chatMessages.forEach(msg => addChatMessage(msg));
        }
    }
    
    showScreen('lobby');
    document.getElementById('startGameBtn').style.display = 'none';
    document.getElementById('readyBtn').style.display = 'block';
    document.getElementById('waitingText').style.display = 'block';
});

socket.on('playerJoined', ({ players }) => {
    updatePlayersList(players);
});

socket.on('playerLeft', ({ players }) => {
    updatePlayersList(players);
});

socket.on('playerReadyUpdate', ({ players }) => {
    updatePlayersList(players);
    
    const myPlayer = players.find(p => p.nickname === currentPlayer);
    const readyBtn = document.getElementById('readyBtn');
    if (readyBtn && myPlayer) {
        readyBtn.textContent = myPlayer.ready ? 'Not Ready' : 'Ready';
        readyBtn.className = myPlayer.ready ? 'btn btn-secondary' : 'btn btn-primary';
    }
});

socket.on('gameStarted', ({ word, isImposter: imposter, currentRound, maxRounds, players, currentTurnPlayer }) => {
    myWord = word;
    isImposter = imposter;
    
    showScreen('game');
    
    document.getElementById('currentRound').textContent = currentRound;
    document.getElementById('maxRounds').textContent = maxRounds;
    
    const wordDisplay = document.getElementById('wordDisplay');
    wordDisplay.textContent = `Your word: ${word}`;
    if (isImposter) {
        wordDisplay.classList.add('imposter');
    } else {
        wordDisplay.classList.remove('imposter');
    }
    
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    document.getElementById('descriptionsList').innerHTML = '';
    
    // Update sidebar players list
    updateGamePlayersList(players, currentTurnPlayer);
    
    if (currentTurnPlayer === currentPlayer) {
        document.getElementById('descriptionInput').style.display = 'block';
    } else {
        document.getElementById('descriptionInput').style.display = 'none';
    }
});

socket.on('nextTurn', ({ currentTurnPlayer, descriptions, players }) => {
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    updateDescriptions(descriptions);
    
    // Update sidebar to highlight current turn player
    if (players) {
        updateGamePlayersList(players, currentTurnPlayer);
    }
    
    if (currentTurnPlayer === currentPlayer && !isEliminated) {
        document.getElementById('descriptionInput').style.display = 'block';
    } else {
        document.getElementById('descriptionInput').style.display = 'none';
    }
});

socket.on('startVoting', ({ descriptions, players }) => {
    showScreen('voting');
    
    // Update voting sidebar
    updateVotingPlayersList(players);
    
    const votingDescList = document.getElementById('votingDescriptionsList');
    votingDescList.innerHTML = '';
    descriptions.forEach(desc => {
        const div = document.createElement('div');
        div.className = 'description-item';
        div.innerHTML = `
            <div class="description-player">${desc.player}</div>
            <div class="description-text">${desc.description}</div>
        `;
        votingDescList.appendChild(div);
    });
    
    const votingSection = document.querySelector('.voting-section');
    const skipVoteBtn = document.getElementById('skipVoteBtn');
    
    if (isEliminated) {
        votingSection.innerHTML = '<h3>You have been eliminated</h3><p>Watch and wait for the results!</p>';
        if (skipVoteBtn) skipVoteBtn.style.display = 'none';
        return;
    }
    
    // Reset skip button
    if (skipVoteBtn) {
        skipVoteBtn.style.display = 'block';
        skipVoteBtn.disabled = false;
        skipVoteBtn.textContent = 'Skip Vote';
    }
    
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
    
    const votingList = document.getElementById('votingPlayersList');
    votingList.innerHTML = '';
    shuffledPlayers.forEach(player => {
        const button = document.createElement('button');
        button.className = 'vote-button';
        button.textContent = player.nickname;
        button.addEventListener('click', () => {
            document.querySelectorAll('.vote-button').forEach(btn => {
                btn.classList.remove('selected');
            });
            button.classList.add('selected');
            selectedVote = player.id;
            
            socket.emit('submitVote', { roomCode: currentRoom, votedPlayerId: player.id });
        });
        votingList.appendChild(button);
    });
});

socket.on('nextRound', ({ currentRound, votedOut, currentTurnPlayer, players }) => {
    showScreen('game');
    
    const myPlayer = players.find(p => p.nickname === currentPlayer);
    if (myPlayer && myPlayer.eliminated) {
        isEliminated = true;
    }
    
    document.getElementById('currentRound').textContent = currentRound;
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    document.getElementById('descriptionsList').innerHTML = '';
    
    if (isEliminated) {
        showError(`${votedOut} was voted out! You've been eliminated - watch the rest of the game!`);
        const wordDisplay = document.getElementById('wordDisplay');
        wordDisplay.textContent = "You've been eliminated!";
        wordDisplay.style.background = '#999';
    } else {
        showError(`${votedOut} was voted out! Starting next round...`);
    }
    
    if (currentTurnPlayer === currentPlayer && !isEliminated) {
        document.getElementById('descriptionInput').style.display = 'block';
    } else {
        document.getElementById('descriptionInput').style.display = 'none';
    }
});

socket.on('gameOver', ({ winner, imposter, crewWord, imposterWord, votedOut, players }) => {
    showScreen('gameOver');
    
    // Update the player list for when they return to lobby
    if (players) {
        updatePlayersList(players);
    }
    
    const winnerText = document.getElementById('winnerText');
    const gameOverInfo = document.getElementById('gameOverInfo');
    
    if (winner === 'crew') {
        winnerText.textContent = '🎉 Crew Wins!';
        winnerText.className = 'winner-text crew-win';
        gameOverInfo.innerHTML = `
            <p><strong>The imposter was:</strong> ${imposter}</p>
            <p><strong>Crew's word was:</strong> ${crewWord}</p>
            <p><strong>Imposter's word was:</strong> ${imposterWord}</p>
            <p><strong>Voted out:</strong> ${votedOut}</p>
            <p>Great job finding the imposter!</p>
        `;
    } else {
        winnerText.textContent = '😈 Imposter Wins!';
        winnerText.className = 'winner-text imposter-win';
        gameOverInfo.innerHTML = `
            <p><strong>The imposter was:</strong> ${imposter}</p>
            <p><strong>Crew's word was:</strong> ${crewWord}</p>
            <p><strong>Imposter's word was:</strong> ${imposterWord}</p>
            <p><strong>Last voted out:</strong> ${votedOut}</p>
            <p>The imposter fooled everyone!</p>
        `;
    }
});

socket.on('error', (message) => {
    showError(message);
});

socket.on('lobbyChatMessage', (chatMessage) => {
    addChatMessage(chatMessage);
});

function updatePlayersList(players) {
    const playersList = document.getElementById('playersList');
    const playerCount = document.getElementById('playerCount');
    
    playerCount.textContent = players.length;
    playersList.innerHTML = '';
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        
        let badges = '';
        if (player.isHost) {
            badges += '<span class="host-badge">HOST</span>';
        } else if (player.ready) {
            badges += '<span class="ready-badge">✓ READY</span>';
        } else {
            badges += '<span class="not-ready-badge">NOT READY</span>';
        }
        
        div.innerHTML = `
            <span class="player-name">${player.nickname}</span>
            ${badges}
        `;
        playersList.appendChild(div);
    });
    
    if (isHost) {
        const nonHostPlayers = players.filter(p => !p.isHost);
        const allReady = nonHostPlayers.every(p => p.ready);
        document.getElementById('startGameBtn').style.display = (players.length >= 3 && allReady) ? 'block' : 'none';
        document.getElementById('waitingText').style.display = 'none';
    }
}

function updateDescriptions(descriptions) {
    const descList = document.getElementById('descriptionsList');
    descList.innerHTML = '';
    
    descriptions.forEach(desc => {
        const div = document.createElement('div');
        div.className = 'description-item';
        div.innerHTML = `
            <div class="description-player">${desc.player}</div>
            <div class="description-text">${desc.description}</div>
        `;
        descList.appendChild(div);
    });
}

function updateGamePlayersList(players, currentTurnPlayer) {
    const gamePlayersList = document.getElementById('gamePlayersList');
    if (!gamePlayersList) return;
    
    gamePlayersList.innerHTML = '';
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'game-player-item';
        
        // Highlight current turn
        if (player.nickname === currentTurnPlayer) {
            div.classList.add('current-turn');
        }
        
        // Show eliminated
        if (player.eliminated) {
            div.classList.add('eliminated');
        }
        
        // Show if it's me and I'm imposter (just for visual flair)
        if (player.nickname === currentPlayer && isImposter) {
            div.classList.add('is-imposter');
        }
        
        let status = '';
        if (player.eliminated) {
            status = ' <span style="color: #95a5a6;">✗ OUT</span>';
        } else if (player.nickname === currentTurnPlayer) {
            status = ' <span style="color: #f39c12;">→ TURN</span>';
        }
        
        div.innerHTML = `
            <div class="game-player-name">${player.nickname}${status}</div>
        `;
        gamePlayersList.appendChild(div);
    });
}

function updateVotingPlayersList(players) {
    const votingGamePlayersList = document.getElementById('votingGamePlayersList');
    if (!votingGamePlayersList) return;
    
    votingGamePlayersList.innerHTML = '';
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'game-player-item';
        
        if (player.eliminated) {
            div.classList.add('eliminated');
        }
        
        let status = '';
        if (player.eliminated) {
            status = ' <span style="color: #95a5a6;">✗ OUT</span>';
        }
        
        div.innerHTML = `
            <div class="game-player-name">${player.nickname}${status}</div>
        `;
        votingGamePlayersList.appendChild(div);
    });
}