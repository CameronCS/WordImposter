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
    currentRoom = roomCode; // Set the room code before joining
    socket.emit('joinRoom', { roomCode, nickname: currentPlayer });
});

document.getElementById('backToHomeBtn').addEventListener('click', () => {
    showScreen('home');
});

// Lobby screen
document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('startGame', currentRoom);
});

// Game screen
document.getElementById('submitDescriptionBtn').addEventListener('click', () => {
    const description = document.getElementById('descriptionText').value.trim();
    console.log('=== Submit button clicked ===');
    console.log('Description:', description);
    console.log('Current room:', currentRoom);
    console.log('Current player:', currentPlayer);
    
    if (!description) {
        showError('Please enter a description');
        return;
    }
    
    socket.emit('submitDescription', { roomCode: currentRoom, description });
    document.getElementById('descriptionText').value = '';
    document.getElementById('descriptionInput').style.display = 'none';
});

// Game over screen
document.getElementById('backToLobbyBtn').addEventListener('click', () => {
    showScreen('lobby');
    // Reset game state
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
    document.getElementById('waitingText').style.display = 'none';
});

socket.on('roomJoined', ({ roomCode, players }) => {
    currentRoom = roomCode;
    document.getElementById('displayRoomCode').textContent = roomCode;
    updatePlayersList(players);
    showScreen('lobby');
    document.getElementById('startGameBtn').style.display = 'none';
    document.getElementById('waitingText').style.display = 'block';
});

socket.on('playerJoined', ({ players }) => {
    updatePlayersList(players);
});

socket.on('playerLeft', ({ players }) => {
    updatePlayersList(players);
});

socket.on('gameStarted', ({ word, isImposter: imposter, currentRound, maxRounds, players, currentTurnPlayer }) => {
    myWord = word;
    isImposter = imposter;
    
    showScreen('game');
    
    document.getElementById('currentRound').textContent = currentRound;
    document.getElementById('maxRounds').textContent = maxRounds;
    
    const wordDisplay = document.getElementById('wordDisplay');
    if (isImposter) {
        wordDisplay.textContent = "You're the IMPOSTER!";
        wordDisplay.classList.add('imposter');
    } else {
        wordDisplay.textContent = `Your word: ${word}`;
        wordDisplay.classList.remove('imposter');
    }
    
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    document.getElementById('descriptionsList').innerHTML = '';
    
    // Show input if it's my turn
    if (currentTurnPlayer === currentPlayer) {
        document.getElementById('descriptionInput').style.display = 'block';
    } else {
        document.getElementById('descriptionInput').style.display = 'none';
    }
});

socket.on('nextTurn', ({ currentTurnPlayer, descriptions }) => {
    console.log('nextTurn event received:', currentTurnPlayer);
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    updateDescriptions(descriptions);
    
    // Show input if it's my turn and I'm not eliminated
    console.log('My name:', currentPlayer, 'Current turn:', currentTurnPlayer, 'Eliminated:', isEliminated);
    if (currentTurnPlayer === currentPlayer && !isEliminated) {
        console.log('It\'s my turn! Showing input');
        document.getElementById('descriptionInput').style.display = 'block';
    } else {
        console.log('Not my turn or eliminated, hiding input');
        document.getElementById('descriptionInput').style.display = 'none';
    }
});

socket.on('startVoting', ({ descriptions, players }) => {
    showScreen('voting');
    
    // Show all descriptions
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
    
    // Randomize player order for voting
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
    
    // Show voting buttons
    const votingList = document.getElementById('votingPlayersList');
    votingList.innerHTML = '';
    shuffledPlayers.forEach(player => {
        const button = document.createElement('button');
        button.className = 'vote-button';
        button.textContent = player.nickname;
        button.addEventListener('click', () => {
            // Remove previous selection
            document.querySelectorAll('.vote-button').forEach(btn => {
                btn.classList.remove('selected');
            });
            // Select this one
            button.classList.add('selected');
            selectedVote = player.id;
            
            // Submit vote
            socket.emit('submitVote', { roomCode: currentRoom, votedPlayerId: player.id });
        });
        votingList.appendChild(button);
    });
});

socket.on('nextRound', ({ currentRound, votedOut, currentTurnPlayer, players }) => {
    showScreen('game');
    
    // Check if I was eliminated
    const myPlayer = players.find(p => p.nickname === currentPlayer);
    if (myPlayer && myPlayer.eliminated) {
        isEliminated = true;
    }
    
    document.getElementById('currentRound').textContent = currentRound;
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    document.getElementById('descriptionsList').innerHTML = '';
    
    if (isEliminated) {
        showError(`${votedOut} was voted out! You've been eliminated - watch the rest of the game!`);
        // Show eliminated status in word display
        const wordDisplay = document.getElementById('wordDisplay');
        wordDisplay.textContent = "You've been eliminated!";
        wordDisplay.style.background = '#999';
    } else {
        showError(`${votedOut} was voted out! Starting next round...`);
    }
    
    // Show input if it's my turn and not eliminated
    if (currentTurnPlayer === currentPlayer && !isEliminated) {
        document.getElementById('descriptionInput').style.display = 'block';
    } else {
        document.getElementById('descriptionInput').style.display = 'none';
    }
});

socket.on('gameOver', ({ winner, imposter, word, votedOut }) => {
    showScreen('gameOver');
    
    const winnerText = document.getElementById('winnerText');
    const gameOverInfo = document.getElementById('gameOverInfo');
    
    if (winner === 'crew') {
        winnerText.textContent = '🎉 Crew Wins!';
        winnerText.className = 'winner-text crew-win';
        gameOverInfo.innerHTML = `
            <p><strong>The imposter was:</strong> ${imposter}</p>
            <p><strong>The word was:</strong> ${word}</p>
            <p><strong>Voted out:</strong> ${votedOut}</p>
            <p>Great job finding the imposter!</p>
        `;
    } else {
        winnerText.textContent = '😈 Imposter Wins!';
        winnerText.className = 'winner-text imposter-win';
        gameOverInfo.innerHTML = `
            <p><strong>The imposter was:</strong> ${imposter}</p>
            <p><strong>The word was:</strong> ${word}</p>
            <p><strong>Last voted out:</strong> ${votedOut}</p>
            <p>The imposter fooled everyone!</p>
        `;
    }
});

socket.on('error', (message) => {
    showError(message);
});

// Helper functions
function updatePlayersList(players) {
    const playersList = document.getElementById('playersList');
    const playerCount = document.getElementById('playerCount');
    
    playerCount.textContent = players.length;
    playersList.innerHTML = '';
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `
            <span class="player-name">${player.nickname}</span>
            ${player.isHost ? '<span class="host-badge">HOST</span>' : ''}
        `;
        playersList.appendChild(div);
    });
    
    // Update start button visibility
    if (isHost) {
        document.getElementById('startGameBtn').style.display = players.length >= 3 ? 'block' : 'none';
        document.getElementById('waitingText').style.display = 'none';
    } else {
        document.getElementById('startGameBtn').style.display = 'none';
        document.getElementById('waitingText').style.display = 'block';
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