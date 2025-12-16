// Create a simple ding sound using Web Audio API
let audioContext = null;

// Initialize audio context on first user interaction
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Call this on any user interaction
document.addEventListener('click', initAudio, { once: true });
document.addEventListener('keydown', initAudio, { once: true });

function playDing() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Resume if suspended
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        // Create oscillator for the ding sound
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Configure the sound - pleasant bell-like tone
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // Higher frequency for ding
        oscillator.type = 'sine';
        
        // Envelope for natural ding decay
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        console.log('🔔 Ding sound played!');
        
    } catch (error) {
        console.log('Audio not supported:', error);
    }
}