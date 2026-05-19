import { state } from './globals.js';
import { formatTime, calculateHaversine, initAudio, playBeep, showOverlay } from './utils.js';
import { initSettings, getSettings } from './settings.js';

// --- DOM Elements ---
const uiPace = document.getElementById('val-pace');
const uiSpm = document.getElementById('val-spm');
const uiTime = document.getElementById('val-time');
const uiDist = document.getElementById('val-dist');
const uiTimeLabel = document.getElementById('label-time');
const uiDistLabel = document.getElementById('label-dist');
const uiLapInfo = document.getElementById('lap-info');

const btnStart = document.getElementById('btn-start');
const btnLap = document.getElementById('btn-lap');
const btnSettings = document.getElementById('btn-settings');
const iconGps = document.getElementById('icon-gps');
const iconAccel = document.getElementById('icon-accel');

const alertOverlay = document.getElementById('interval-alert');

// Initialize settings modal handlers
initSettings();

// Update labels based on state
function updateLabels() {
    if (state.targetType === 'free') {
        uiTimeLabel.innerText = "Lap Time";
        uiDistLabel.innerText = "Lap Distance";
        uiTimeLabel.classList.remove('rest-mode');
        uiDistLabel.classList.remove('rest-mode');
        uiLapInfo.innerText = `LAP: ${state.lapCount}`;
        uiLapInfo.className = '';
    } else if (state.intervalState === 'rest') {
        uiTimeLabel.innerText = "Rest Time";
        uiDistLabel.innerText = "Rest Dist";
        uiTimeLabel.classList.add('rest-mode');
        uiDistLabel.classList.add('rest-mode');
        uiLapInfo.innerText = `LAP: ${state.lapCount} (REST)`;
        uiLapInfo.className = 'status-mode-rest';
    } else {
        uiTimeLabel.classList.remove('rest-mode');
        uiDistLabel.classList.remove('rest-mode');
        uiLapInfo.innerText = `LAP: ${state.lapCount} (WORK)`;
        uiLapInfo.className = 'status-mode-work';

        if (state.targetType === 'distance') {
            uiTimeLabel.innerText = "Lap Time";
            uiDistLabel.innerText = "Rem. Dist";
        } else if (state.targetType === 'time') {
            uiTimeLabel.innerText = "Rem. Time";
            uiDistLabel.innerText = "Lap Dist";
        }
    }

    if (state.intervalState === 'work' && state.targetType === 'time') {
        uiTime.innerText = formatTime(state.targetValue);
        uiDist.innerText = "0";
    } else if (state.intervalState === 'work' && state.targetType === 'distance') {
        uiDist.innerText = Math.floor(state.targetValue);
        uiTime.innerText = "0:00.0";
    } else {
        uiDist.innerText = "0";
        uiTime.innerText = "0:00.0";
    }
}

// Listen for settings changes
window.addEventListener('settings:updated', () => {
    updateLabels();
});

// --- Core Functions ---
async function toggleWorkout() {
    if (!state.isRunning) {
        initAudio(state);

        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceMotionEvent.requestPermission();
                if (permissionState !== 'granted') alert("Accelerometer access is required.");
            } catch (e) { console.error(e); }
        }

        try { if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen'); }
        catch (err) { console.log(`Wake Lock error: ${err.message}`); }

        startWorkout();
    } else {
        stopWorkout();
    }
}

function startWorkout() {
    state.isRunning = true;
    btnStart.textContent = "Stop";
    btnStart.classList.add("running");
    btnLap.disabled = false;
    btnSettings.disabled = true;

    const now = Date.now();
    state.sessionStartTime = now;
    state.lapStartTime = now;
    state.lapDistance = 0;
    state.lapCount = 1;
    state.intervalState = 'work';
    state.lastPosition = null;
    state.speedBuffer = [];

    state.accelBuffer = [];
    state.previousMag = null;
    state.lastStrokeTime = 0;
    state.strokeIntervals = [];

    state.lastGpsTime = 0;
    state.lastAccelTime = 0;
    iconGps.classList.remove('error');

    state.timerInterval = setInterval(updateTimer, 100);

    if ("geolocation" in navigator) {
        state.geoWatchId = navigator.geolocation.watchPosition(
            handlePosition, handleGpsError,
            { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
        );
    } else { iconGps.classList.add('error'); }

    window.addEventListener('devicemotion', handleMotion);
}

function stopWorkout() {
    state.isRunning = false;
    btnStart.textContent = "Start";
    btnStart.classList.remove("running");
    btnLap.disabled = true;
    btnSettings.disabled = false;

    clearInterval(state.timerInterval);
    if (state.geoWatchId) navigator.geolocation.clearWatch(state.geoWatchId);
    window.removeEventListener('devicemotion', handleMotion);

    if (state.wakeLock !== null) { state.wakeLock.release(); state.wakeLock = null; }

    uiPace.innerText = "--:--";
    uiSpm.innerText = "0";
    iconGps.classList.remove('active', 'error');
    iconAccel.classList.remove('active');
}

function triggerRest(excessDist = 0, excessTime = 0) {
    playBeep(state);
    showOverlay(alertOverlay);

    state.lapCount++;
    state.intervalState = 'rest';

    state.lapStartTime = Date.now() - excessTime;
    state.lapDistance = excessDist;

    updateLabels();

    uiTime.innerText = formatTime(excessTime);
    uiDist.innerText = Math.floor(excessDist);
}

function triggerLap() {
    if (!state.isRunning) return;

    state.lapCount++;
    if (state.targetType !== 'free') state.intervalState = 'work';

    state.lapStartTime = Date.now();
    state.lapDistance = 0;

    updateLabels();
}

function updateTimer() {
    const now = Date.now();
    state.elapsedLapTime = now - state.lapStartTime;

    if (state.targetType === 'time' && state.intervalState === 'work') {
        let remainingTime = state.targetValue - state.elapsedLapTime;
        if (remainingTime <= 0) {
            triggerRest(0, -remainingTime);
            return;
        }
        uiTime.innerText = formatTime(remainingTime);
    } else {
        uiTime.innerText = formatTime(state.elapsedLapTime);
    }

    if (now - state.lastGpsTime < 5000 && state.lastGpsTime !== 0) {
        iconGps.classList.add('active'); iconGps.classList.remove('error');
    } else if (!iconGps.classList.contains('error')) { iconGps.classList.remove('active'); }
    if (now - state.lastAccelTime < 2000 && state.lastAccelTime !== 0) iconAccel.classList.add('active');
    else iconAccel.classList.remove('active');
}

function handlePosition(position) {
    if (!state.isRunning) return;
    state.lastGpsTime = Date.now();

    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    let rawSpeed = position.coords.speed;

    if (state.lastPosition) {
        const distDiff = calculateHaversine(state.lastPosition.lat, state.lastPosition.lon, lat, lon);
        state.lapDistance += distDiff;

        if (state.targetType === 'distance' && state.intervalState === 'work') {
            let remainingDist = state.targetValue - state.lapDistance;
            if (remainingDist <= 0) {
                triggerRest(-remainingDist, 0);
            } else {
                uiDist.innerText = Math.floor(remainingDist);
            }
        } else {
            uiDist.innerText = Math.floor(state.lapDistance);
        }

        if (rawSpeed === null) {
            const timeDiff = (position.timestamp - state.lastPosition.timestamp) / 1000;
            if (timeDiff > 0) rawSpeed = distDiff / timeDiff;
        }
    }

    state.lastPosition = { lat, lon, timestamp: position.timestamp };

    if (rawSpeed !== null && rawSpeed >= 0) {
        state.speedBuffer.push(rawSpeed);
        if (state.speedBuffer.length > 3) state.speedBuffer.shift();
        const avgSpeed = state.speedBuffer.reduce((a, b) => a + b) / state.speedBuffer.length;
        updatePace(avgSpeed);
    }
}

function handleGpsError(err) {
    state.lastGpsTime = 0;
    iconGps.classList.remove('active');
    iconGps.classList.add('error');
}

function updatePace(speedMs) {
    if (speedMs < 0.5) { uiPace.innerText = "--:--"; return; }
    const secondsPer500 = 500 / speedMs;
    const mins = Math.floor(secondsPer500 / 60);
    const secs = Math.floor(secondsPer500 % 60);
    uiPace.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function handleMotion(event) {
    if (!state.isRunning) return;
    let acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc) return;

    let x = acc.x || 0, y = acc.y || 0, z = acc.z || 0;
    let mag = Math.sqrt(x*x + y*y + z*z);
    if (mag > 0.1) state.lastAccelTime = Date.now();
    if (event.acceleration === null) mag = Math.abs(mag - 9.81);

    const now = Date.now();
    state.accelBuffer.push({ time: now, val: mag });
    while (state.accelBuffer.length > 0 && now - state.accelBuffer[0].time > 10000) state.accelBuffer.shift();
    if (state.accelBuffer.length < 10) return;

    let minMag = Infinity, maxMag = -Infinity;
    for (let i = 0; i < state.accelBuffer.length; i++) {
        if (state.accelBuffer[i].val < minMag) minMag = state.accelBuffer[i].val;
        if (state.accelBuffer[i].val > maxMag) maxMag = state.accelBuffer[i].val;
    }

    const threshold = minMag + 0.1 * (maxMag - minMag);

    if (state.previousMag !== null && state.previousMag > threshold && mag <= threshold) {
        if (now - state.lastStrokeTime > 1000) {
            if (state.lastStrokeTime > 0) {
                state.strokeIntervals.push(now - state.lastStrokeTime);
                if (state.strokeIntervals.length > 3) state.strokeIntervals.shift();
                const avgInterval = state.strokeIntervals.reduce((a, b) => a + b) / state.strokeIntervals.length;
                const spm = Math.round(60000 / avgInterval);
                if (spm >= 15 && spm <= 60) uiSpm.innerText = spm;
            }
            state.lastStrokeTime = now;
        }
    }
    state.previousMag = mag;
    if (now - state.lastStrokeTime > 5000) { uiSpm.innerText = "0"; state.strokeIntervals = []; }
}

// Wire controls
btnStart.addEventListener('click', toggleWorkout);
btnLap.addEventListener('click', triggerLap);

// Initial UI
updateLabels();
