export const state = {
    isRunning: false,
    lapCount: 1,
    intervalState: 'work', // 'work' or 'rest'

    // Target Settings
    targetType: 'free', // 'free', 'distance', 'time'
    targetValue: 0,     // meters or milliseconds

    // Timing & distance
    sessionStartTime: 0,
    lapStartTime: 0,
    elapsedLapTime: 0,

    totalDistance: 0,
    lapDistance: 0,
    lastPosition: null,
    speedBuffer: [],

    timerInterval: null,
    geoWatchId: null,
    wakeLock: null,
    audioCtx: null,

    lastGpsTime: 0,
    lastAccelTime: 0,

    // Stroke tracking
    lastStrokeTime: 0,
    strokeIntervals: [],
    accelBuffer: [],
    previousMag: null
};
