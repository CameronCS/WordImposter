const socket = io();

// Game state
let currentRoom = null;
let currentPlayer = null;
let isHost = false;
let myWord = null;
let isImposter = false;
let selectedVote = null;
let isEliminated = false;
let voteLocked = false;
let votedOutHistory = []; // Track who was voted out each round

// Reset all game state (call when returning to lobby or starting new game)
function resetGameState() {
    myWord = null;
    isImposter = false;
    isEliminated = false;
    selectedVote = null;
    voteLocked = false;
    votedOutHistory = [];
}

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
    
    // Request public lobbies
    socket.emit('getPublicLobbies');
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

// Back to menu from lobby
document.getElementById('backToMenuBtn').addEventListener('click', () => {
    // Properly leave the room
    if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
    }
    
    // Reset all state
    currentRoom = null;
    isHost = false;
    myWord = null;
    isImposter = false;
    selectedVote = null;
    isEliminated = false;
    voteLocked = false;
    
    // Clear displays
    document.getElementById('playersList').innerHTML = '';
    document.getElementById('lobbyChatMessages').innerHTML = '';
    
    showScreen('home');
});

// Lobby screen - Ready button
const readyBtn = document.getElementById('readyBtn');
if (readyBtn) {
    readyBtn.addEventListener('click', () => {
        socket.emit('toggleReady', currentRoom);
    });
}

// Room settings update (host only)
const updateSettingsBtn = document.getElementById('updateSettingsBtn');
if (updateSettingsBtn) {
    updateSettingsBtn.addEventListener('click', () => {
        const maxRounds = parseInt(document.getElementById('maxRoundsInput').value);
        const minPlayersForImposterWin = parseInt(document.getElementById('minPlayersInput').value);
        const isPrivate = document.getElementById('privateRoomCheckbox').checked;
        
        socket.emit('updateRoomSettings', { 
            roomCode: currentRoom, 
            maxRounds,
            minPlayersForImposterWin,
            isPrivate 
        });
    });
}

// Public lobbies refresh
const refreshLobbiesBtn = document.getElementById('refreshLobbiesBtn');
if (refreshLobbiesBtn) {
    refreshLobbiesBtn.addEventListener('click', () => {
        socket.emit('getPublicLobbies');
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
    
    if (description.length > 50) {
        showError('Maximum 50 characters allowed!');
        return;
    }
    
    socket.emit('submitDescription', { roomCode: currentRoom, description });
    document.getElementById('descriptionText').value = '';
    document.getElementById('descriptionInput').style.display = 'none';
});

// Voting screen - Lock vote button
const lockVoteBtn = document.getElementById('lockVoteBtn');
if (lockVoteBtn) {
    lockVoteBtn.addEventListener('click', () => {
        if (!selectedVote || voteLocked) return;
        
        // Lock the vote
        voteLocked = true;
        lockVoteBtn.disabled = true;
        lockVoteBtn.textContent = '✓ Vote Locked';
        
        // Disable all vote buttons
        document.querySelectorAll('.vote-button').forEach(btn => {
            btn.disabled = true;
        });
        
        // Disable skip button
        const skipBtn = document.getElementById('skipVoteBtn');
        if (skipBtn) {
            skipBtn.disabled = true;
        }
        
        // Add checkmark to my name in sidebar
        const mySidebarItem = document.getElementById(`voting-sidebar-${socket.id}`);
        if (mySidebarItem) {
            const nameEl = mySidebarItem.querySelector('.game-player-name');
            if (nameEl && !nameEl.innerHTML.includes('✓')) {
                nameEl.innerHTML += ' <span style="color: #2ecc71;">✓</span>';
            }
        }
        
        socket.emit('submitVote', { roomCode: currentRoom, votedPlayerId: selectedVote });
    });
}

// Voting screen - Skip vote button
const skipVoteBtn = document.getElementById('skipVoteBtn');
if (skipVoteBtn) {
    skipVoteBtn.addEventListener('click', () => {
        if (voteLocked) return;
        
        // Lock the vote
        voteLocked = true;
        selectedVote = 'SKIP_VOTE';
        skipVoteBtn.disabled = true;
        skipVoteBtn.textContent = '✓ Vote Skipped';
        
        // Disable all vote buttons and lock button
        document.querySelectorAll('.vote-button').forEach(btn => {
            btn.disabled = true;
        });
        if (lockVoteBtn) {
            lockVoteBtn.disabled = true;
        }
        
        // Add checkmark to my name in sidebar
        const mySidebarItem = document.getElementById(`voting-sidebar-${socket.id}`);
        if (mySidebarItem) {
            const nameEl = mySidebarItem.querySelector('.game-player-name');
            if (nameEl && !nameEl.innerHTML.includes('✓')) {
                nameEl.innerHTML += ' <span style="color: #2ecc71;">✓</span>';
            }
        }
        
        socket.emit('submitVote', { roomCode: currentRoom, votedPlayerId: 'SKIP_VOTE' });
    });
}

// Game over screen
document.getElementById('backToLobbyBtn').addEventListener('click', () => {
    showScreen('lobby');
    resetGameState();
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
    
    // Show room settings for host
    document.getElementById('roomSettings').style.display = 'block';
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
    
    // Hide room settings for non-host
    document.getElementById('roomSettings').style.display = 'none';
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

socket.on('gameStarted', ({ word, isImposter: imposter, currentRound, maxRounds, minPlayers, players, currentTurnPlayer }) => {
    myWord = word;
    isImposter = false; // Never know if you're imposter
    isEliminated = false; // Must be false for new game
    votedOutHistory = []; // Reset history for new game
    voteLocked = false; // Reset vote lock
    selectedVote = null; // Reset vote selection
    
    showScreen('game');
    
    document.getElementById('currentRound').textContent = currentRound;
    document.getElementById('maxRounds').textContent = maxRounds;
    
    const wordDisplay = document.getElementById('wordDisplay');
    wordDisplay.textContent = `Your word: ${word}`;
    wordDisplay.classList.remove('imposter'); // Never show imposter styling
    
    // Update round info to show min players
    const roundInfo = document.querySelector('.round-info');
    if (roundInfo) {
        roundInfo.innerHTML = `Round <span id="currentRound">${currentRound}</span>/<span id="maxRounds">${maxRounds}</span><br><span style="font-size: 0.8em;">Imposter wins at ${minPlayers} crew left</span>`;
    }
    
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    document.getElementById('descriptionsList').innerHTML = '';
    
    // Reset timer display
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = '60';
        timerDisplay.style.color = '#ffffff';
        timerDisplay.style.fontWeight = 'normal';
    }
    
    // Update sidebar players list
    updateGamePlayersList(players, currentTurnPlayer);
    updateVotedOutList();
    
    if (currentTurnPlayer === currentPlayer) {
        document.getElementById('descriptionInput').style.display = 'block';
        playDing(); // Play sound when it's your turn
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
        playDing(); // Play sound when it's your turn
    } else {
        document.getElementById('descriptionInput').style.display = 'none';
    }
});

socket.on('startVoting', ({ descriptions, players }) => {
    showScreen('voting');
    
    // Reset vote lock for new voting phase
    voteLocked = false;
    
    // Update voting sidebar
    updateVotingPlayersList(players);
    updateVotedOutList(); // Show voted out history
    
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
    
    // Reset lock button
    const lockBtn = document.getElementById('lockVoteBtn');
    if (lockBtn) {
        lockBtn.style.display = 'none';
        lockBtn.disabled = false;
        lockBtn.textContent = 'Lock In Vote';
    }
    
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
    
    const votingList = document.getElementById('votingPlayersList');
    votingList.innerHTML = '';
    shuffledPlayers.forEach(player => {
        const button = document.createElement('button');
        button.className = 'vote-button';
        button.textContent = player.nickname;
        button.addEventListener('click', () => {
            if (voteLocked) return; // Can't change vote once locked
            
            // Just select, don't submit yet
            document.querySelectorAll('.vote-button').forEach(btn => {
                btn.classList.remove('selected');
            });
            button.classList.add('selected');
            selectedVote = player.id;
            
            // Show lock button
            const lockBtn = document.getElementById('lockVoteBtn');
            if (lockBtn) {
                lockBtn.style.display = 'block';
            }
        });
        votingList.appendChild(button);
    });
});

socket.on('nextRound', ({ currentRound, maxRounds, minPlayers, votedOut, currentTurnPlayer, players }) => {
    showScreen('game');
    
    // Add to voted out history (only if not skipped)
    if (votedOut && votedOut !== 'No one (votes skipped)') {
        votedOutHistory.push({
            round: currentRound - 1, // Previous round
            player: votedOut
        });
    }
    
    const myPlayer = players.find(p => p.nickname === currentPlayer);
    if (myPlayer && myPlayer.eliminated) {
        isEliminated = true;
    }
    
    document.getElementById('currentRound').textContent = currentRound;
    document.getElementById('currentTurnPlayer').textContent = currentTurnPlayer;
    document.getElementById('descriptionsList').innerHTML = '';
    
    // Update round info with settings
    const roundInfo = document.querySelector('.round-info');
    if (roundInfo && maxRounds && minPlayers) {
        roundInfo.innerHTML = `Round <span id="currentRound">${currentRound}</span>/<span id="maxRounds">${maxRounds}</span><br><span style="font-size: 0.8em;">Imposter wins at ${minPlayers} crew left</span>`;
    }
    
    // Update sidebar
    updateGamePlayersList(players, currentTurnPlayer);
    updateVotedOutList();
    
    // Reset timer display for new round
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = '60';
        timerDisplay.style.color = '#ffffff';
        timerDisplay.style.fontWeight = 'normal';
    }
    
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

socket.on('gameOver', ({ winner, imposter, crewWord, imposterWord, votedOut, reason, players }) => {
    showScreen('gameOver');
    
    // Reset all game state
    resetGameState();
    
    // Update the player list for when they return to lobby
    if (players) {
        updatePlayersList(players);
    }
    
    const winnerText = document.getElementById('winnerText');
    const gameOverInfo = document.getElementById('gameOverInfo');
    
    const reasonText = reason ? `<p><em>${reason}</em></p>` : '';
    
    if (winner === 'crew') {
        winnerText.textContent = '🎉 Crew Wins!';
        winnerText.className = 'winner-text crew-win';
        gameOverInfo.innerHTML = `
            <p><strong>The imposter was:</strong> ${imposter}</p>
            <p><strong>Crew's word was:</strong> ${crewWord}</p>
            <p><strong>Imposter's word was:</strong> ${imposterWord}</p>
            <p><strong>Voted out:</strong> ${votedOut}</p>
            ${reasonText}
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
            ${reasonText}
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

socket.on('playerVoted', ({ playerId }) => {
    // Add checkmark to player in sidebar
    const sidebarItem = document.getElementById(`voting-sidebar-${playerId}`);
    if (sidebarItem) {
        const nameEl = sidebarItem.querySelector('.game-player-name');
        if (nameEl && !nameEl.innerHTML.includes('✓')) {
            nameEl.innerHTML += ' <span style="color: #2ecc71;">✓</span>';
        }
    }
});

socket.on('roomSettingsUpdated', ({ maxRounds, minPlayersForImposterWin, isPrivate }) => {
    // Update settings display
    document.getElementById('maxRoundsInput').value = maxRounds;
    document.getElementById('minPlayersInput').value = minPlayersForImposterWin;
    document.getElementById('privateRoomCheckbox').checked = isPrivate;
});

socket.on('publicLobbies', (lobbies) => {
    const lobbyList = document.getElementById('publicLobbiesList');
    if (!lobbyList) return;
    
    lobbyList.innerHTML = '';
    
    if (lobbies.length === 0) {
        lobbyList.innerHTML = '<div class="lobby-card-empty">No public lobbies available<br>Create one!</div>';
        return;
    }
    
    lobbies.forEach(lobby => {
        const card = document.createElement('div');
        card.className = 'lobby-card';
        card.innerHTML = `
            <div class="lobby-card-code">${lobby.code}</div>
            <div class="lobby-card-info">
                👥 ${lobby.playerCount} player${lobby.playerCount !== 1 ? 's' : ''} | 
                🔄 ${lobby.maxRounds} round${lobby.maxRounds !== 1 ? 's' : ''}
            </div>
        `;
        card.addEventListener('click', () => {
            document.getElementById('roomCodeInput').value = lobby.code;
            document.getElementById('joinGameBtn').click();
        });
        lobbyList.appendChild(card);
    });
});

socket.on('hostChanged', ({ newHost, players }) => {
    updatePlayersList(players);
    
    // Check if I'm the new host
    const myPlayer = players.find(p => p.nickname === currentPlayer);
    if (myPlayer && myPlayer.isHost) {
        isHost = true;
        // Show host controls
        document.getElementById('roomSettings').style.display = 'block';
        document.getElementById('startGameBtn').style.display = 'block';
        document.getElementById('readyBtn').style.display = 'none';
        document.getElementById('waitingText').style.display = 'none';
        
        showError(`You are now the host!`);
    } else {
        showError(`${newHost} is now the host`);
    }
});

socket.on('kicked', (message) => {
    showError(message);
    currentRoom = null;
    isHost = false;
    setTimeout(() => {
        showScreen('home');
    }, 2000);
});

socket.on('playerKicked', ({ kickedPlayer, players }) => {
    updatePlayersList(players);
    showError(`${kickedPlayer} was kicked from the lobby`);
});

socket.on('kickVoteRecorded', ({ target, votes, needed }) => {
    showError(`Vote to kick ${target} recorded (${votes}/${needed})`);
});

socket.on('turnTimerUpdate', ({ timeLeft }) => {
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = timeLeft;
        
        // Change color when time is running out
        if (timeLeft <= 10) {
            timerDisplay.style.color = '#e74c3c';
            timerDisplay.style.fontWeight = 'bold';
        } else if (timeLeft <= 30) {
            timerDisplay.style.color = '#f39c12';
        } else {
            timerDisplay.style.color = '#ffffff';
            timerDisplay.style.fontWeight = 'normal';
        }
    }
});

socket.on('gameEnded', ({ reason }) => {
    showError(`Game ended: ${reason}`);
    setTimeout(() => {
        showScreen('lobby');
    }, 2000);
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
        
        // Add vote kick button for non-host players (if I'm not that player)
        let kickButton = '';
        if (!player.isHost && player.nickname !== currentPlayer) {
            kickButton = `<button class="btn-kick" data-player-id="${player.id}" data-player-name="${player.nickname}">🚫 Kick</button>`;
        }
        
        div.innerHTML = `
            <div class="player-item-left">
                ${badges}
                <span class="player-name">${player.nickname}</span>
            </div>
            <div class="player-item-right">
                ${kickButton}
            </div>
        `;
        
        // Add kick button event listener
        const kickBtn = div.querySelector('.btn-kick');
        if (kickBtn) {
            kickBtn.addEventListener('click', () => {
                const playerId = kickBtn.getAttribute('data-player-id');
                const playerName = kickBtn.getAttribute('data-player-name');
                if (confirm(`Vote to kick ${playerName}?`)) {
                    socket.emit('voteKick', { roomCode: currentRoom, targetPlayerId: playerId });
                }
            });
        }
        
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

function updateVotedOutList() {
    // Update game screen voted out list
    const votedOutSection = document.getElementById('votedOutSection');
    const votedOutList = document.getElementById('votedOutList');
    
    if (votedOutSection && votedOutList) {
        if (votedOutHistory.length === 0) {
            votedOutSection.style.display = 'none';
        } else {
            votedOutSection.style.display = 'block';
            votedOutList.innerHTML = '';
            
            votedOutHistory.forEach(entry => {
                const div = document.createElement('div');
                div.className = 'voted-out-item';
                div.innerHTML = `
                    <span class="voted-out-item-round">R${entry.round}</span>
                    <span class="voted-out-item-name">${entry.player}</span>
                `;
                votedOutList.appendChild(div);
            });
        }
    }
    
    // Update voting screen voted out list
    const votingVotedOutSection = document.getElementById('votingVotedOutSection');
    const votingVotedOutList = document.getElementById('votingVotedOutList');
    
    if (votingVotedOutSection && votingVotedOutList) {
        if (votedOutHistory.length === 0) {
            votingVotedOutSection.style.display = 'none';
        } else {
            votingVotedOutSection.style.display = 'block';
            votingVotedOutList.innerHTML = '';
            
            votedOutHistory.forEach(entry => {
                const div = document.createElement('div');
                div.className = 'voted-out-item';
                div.innerHTML = `
                    <span class="voted-out-item-round">R${entry.round}</span>
                    <span class="voted-out-item-name">${entry.player}</span>
                `;
                votingVotedOutList.appendChild(div);
            });
        }
    }
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
        
        let status = '';
        if (player.eliminated) {
            status = ' <span style="color: #95a5a6;">✗ OUT</span>';
        } else if (player.nickname === currentTurnPlayer) {
            status = ' <span style="color: #f39c12;">→ TURN</span>';
        }
        
        // Add kick button for non-host, non-self players
        let kickButton = '';
        if (!player.isHost && player.nickname !== currentPlayer) {
            kickButton = `<button class="btn-kick-small" data-player-id="${player.id}" data-player-name="${player.nickname}" title="Vote to kick ${player.nickname}">🚫</button>`;
        }
        
        div.innerHTML = `
            <div class="game-player-name">${player.nickname}${status}</div>
            ${kickButton}
        `;
        
        // Add event listener for kick button
        const kickBtn = div.querySelector('.btn-kick-small');
        if (kickBtn) {
            kickBtn.addEventListener('click', () => {
                const playerId = kickBtn.getAttribute('data-player-id');
                const playerName = kickBtn.getAttribute('data-player-name');
                if (confirm(`Vote to kick ${playerName}?`)) {
                    socket.emit('voteKick', { roomCode: currentRoom, targetPlayerId: playerId });
                }
            });
        }
        
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
        div.id = `voting-sidebar-${player.id}`;
        
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