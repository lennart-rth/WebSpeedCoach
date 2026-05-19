export function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const dec = Math.floor((ms % 1000) / 100);
    return `${m}:${s.toString().padStart(2, '0')}.${dec}`;
}

export function calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function initAudio(state) {
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') state.audioCtx.resume();
}

export function playBeep(state) {
    if (!state.audioCtx) return;
    const audioCtx = state.audioCtx;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(1, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.8);
    osc.stop(audioCtx.currentTime + 0.8);
}

export function showOverlay(alertOverlayElement) {
    if (!alertOverlayElement) return;
    alertOverlayElement.classList.add('show');
    setTimeout(() => { alertOverlayElement.classList.remove('show'); }, 2000);
}
