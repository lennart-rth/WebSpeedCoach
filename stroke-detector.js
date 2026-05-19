/**
 * StrokeDetector: Real-time rowing stroke detection from tri-axial accelerometer data.
 * 
 * Based on the algorithm spec: EMA smoothing -> dominant axis selection -> catch detection
 * state machine -> stroke normalization -> finish detection -> rhythm ratio computation.
 */

class EMAFilter {
    constructor(alpha = 0.3) {
        this.alpha = alpha;
        this.value = null;
    }

    process(sample) {
        if (this.value === null) {
            this.value = sample;
        } else {
            this.value = this.alpha * sample + (1 - this.alpha) * this.value;
        }
        return this.value;
    }

    reset() {
        this.value = null;
    }
}

class CircularBuffer {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = [];
    }

    push(value) {
        this.buffer.push(value);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    push_timestamped(time, value) {
        this.push({ time, value });
    }

    get length() {
        return this.buffer.length;
    }

    get(index) {
        return this.buffer[index];
    }

    slice(start, end) {
        return this.buffer.slice(start, end);
    }

    clear() {
        this.buffer = [];
    }

    // Get all values from this buffer
    get values() {
        return this.buffer;
    }

    // Get min and max values
    get min() {
        if (this.buffer.length === 0) return null;
        return Math.min(...this.buffer);
    }

    get max() {
        if (this.buffer.length === 0) return null;
        return Math.max(...this.buffer);
    }

    // Compute variance
    variance() {
        if (this.buffer.length < 2) return 0;
        const mean = this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
        const squaredDiffs = this.buffer.map(v => (v - mean) ** 2);
        return squaredDiffs.reduce((a, b) => a + b, 0) / this.buffer.length;
    }
}

export class StrokeDetector {
    constructor(config = {}) {
        // Configuration (from spec)
        this.FS = config.FS || 100.0; // Sample rate (Hz)
        this.DOM_BUFFER_SIZE = config.DOM_BUFFER_SIZE || Math.floor(20.0 * this.FS); // 2000 samples @ 100 Hz
        this.MIN_MAX_BUFFER_SIZE = config.MIN_MAX_BUFFER_SIZE || Math.floor(10.0 * this.FS); // 1000 samples
        this.MIN_STROKE_TIME_SEC = config.MIN_STROKE_TIME_SEC || 0.9;
        this.EMA_ALPHA_AXES = config.EMA_ALPHA_AXES || 0.3;
        this.EMA_ALPHA_CHOSEN = config.EMA_ALPHA_CHOSEN || 0.2;
        this.THRESHOLD_FRACTION = config.THRESHOLD_FRACTION || 0.25;
        this.NORMALIZATION_LENGTH = config.NORMALIZATION_LENGTH || 100;
        this.FINISH_SLOPE_THRESHOLD = config.FINISH_SLOPE_THRESHOLD || -0.02;
        this.DOM_EVAL_PERIOD = config.DOM_EVAL_PERIOD || 1.0; // seconds

        // EMA filters per axis
        this.emaX = new EMAFilter(this.EMA_ALPHA_AXES);
        this.emaY = new EMAFilter(this.EMA_ALPHA_AXES);
        this.emaZ = new EMAFilter(this.EMA_ALPHA_AXES);
        this.emaChosen = new EMAFilter(this.EMA_ALPHA_CHOSEN);

        // Buffers for dominant axis selection
        this.xBuf = new CircularBuffer(this.DOM_BUFFER_SIZE);
        this.yBuf = new CircularBuffer(this.DOM_BUFFER_SIZE);
        this.zBuf = new CircularBuffer(this.DOM_BUFFER_SIZE);

        // Buffer for rolling min/max threshold
        this.chosenBuf = new CircularBuffer(this.MIN_MAX_BUFFER_SIZE);

        // History buffer: time-ordered (time, value) pairs
        this.historyBuf = new CircularBuffer(Math.floor(30.0 * this.FS)); // 30s history

        // Dominant axis tracking
        this.currentDomAxis = 1; // 1=X, 2=Y, 3=Z
        this.lastDomEvalTime = 0;

        // Catch detection state
        this.isBelowThreshold = false;
        this.tempMinVal = Infinity;
        this.tempMinTime = null;
        this.lastCatchTime = null;

        // Results
        this.recentStrokes = []; // Array of { normalized: [...100 values], finishIdx, ratio, catchTime }
        this.recentRatios = []; // Array of { time, ratio }
        this.currentSPM = 0; // Current strokes per minute
    }

    /**
     * Process a single accelerometer sample.
     * @param {number} t - timestamp in seconds
     * @param {number} ax - X acceleration
     * @param {number} ay - Y acceleration
     * @param {number} az - Z acceleration
     */
    process(t, ax, ay, az) {
        // Apply EMA per axis
        const xs = this.emaX.process(ax);
        const ys = this.emaY.process(ay);
        const zs = this.emaZ.process(az);

        // Append to dominant-axis buffers
        this.xBuf.push(xs);
        this.yBuf.push(ys);
        this.zBuf.push(zs);

        // Update dominant axis every 1 second (if we have enough samples)
        if (t - this.lastDomEvalTime >= this.DOM_EVAL_PERIOD && this.xBuf.length >= 100) {
            const varX = this.xBuf.variance();
            const varY = this.yBuf.variance();
            const varZ = this.zBuf.variance();

            if (varX >= varY && varX >= varZ) {
                this.currentDomAxis = 1;
            } else if (varY >= varX && varY >= varZ) {
                this.currentDomAxis = 2;
            } else {
                this.currentDomAxis = 3;
            }
            this.lastDomEvalTime = t;
        }

        // Get chosen-axis raw value
        let chosenRaw;
        if (this.currentDomAxis === 1) {
            chosenRaw = xs;
        } else if (this.currentDomAxis === 2) {
            chosenRaw = ys;
        } else {
            chosenRaw = zs;
        }

        // Apply EMA to chosen axis
        const chosenSmooth = this.emaChosen.process(chosenRaw);

        // Append to history and chosen buffers
        this.historyBuf.push_timestamped(t, chosenSmooth);
        this.chosenBuf.push(chosenSmooth);

        // Compute rolling threshold once we have enough samples
        if (this.chosenBuf.length > 20) {
            const rMin = this.chosenBuf.min;
            const rMax = this.chosenBuf.max;
            const threshold25 = rMin + this.THRESHOLD_FRACTION * (rMax - rMin);

            // Catch detection state machine
            if (chosenSmooth < threshold25) {
                if (!this.isBelowThreshold) {
                    // Transition: above -> below
                    this.isBelowThreshold = true;
                    this.tempMinVal = chosenSmooth;
                    this.tempMinTime = t;
                } else {
                    // Already below; update if this is a lower minimum
                    if (chosenSmooth < this.tempMinVal) {
                        this.tempMinVal = chosenSmooth;
                        this.tempMinTime = t;
                    }
                }
            } else if (this.isBelowThreshold) {
                // Transition: below -> above (rising above threshold)
                this.isBelowThreshold = false;

                if (this.lastCatchTime === null) {
                    // First catch
                    this.lastCatchTime = this.tempMinTime;
                } else if (this.tempMinTime - this.lastCatchTime > this.MIN_STROKE_TIME_SEC) {
                    // Valid stroke detected
                    this._processStroke(this.lastCatchTime, this.tempMinTime);
                    this.lastCatchTime = this.tempMinTime;
                }
            }
        }
    }

    /**
     * Extract and process a stroke between two catch times.
     * @private
     */
    _processStroke(catchTime1, catchTime2) {
        // Extract history between two catch times
        const strokeData = [];
        for (let item of this.historyBuf.values) {
            if (item.time >= catchTime1 && item.time <= catchTime2) {
                strokeData.push(item.value);
            }
        }

        if (strokeData.length > 10) {
            // Normalize to 100 points
            const normalized = this._resampleTo100(strokeData);

            // Detect finish index
            const finishIdx = this._detectFinishIdx(normalized);

            // Compute ratios
            const drivePct = finishIdx;
            const recoveryPct = this.NORMALIZATION_LENGTH - finishIdx;
            const ratio = recoveryPct > 0 ? drivePct / recoveryPct : 0;

            // Store stroke
            const stroke = {
                normalized,
                finishIdx,
                drivePct,
                recoveryPct,
                ratio,
                catchTime: catchTime2,
                duration: catchTime2 - catchTime1
            };
            this.recentStrokes.push(stroke);

            // Keep only last 20 strokes
            if (this.recentStrokes.length > 20) {
                this.recentStrokes.shift();
            }

            // Compute current SPM from recent strokes
            this._updateSPM();

            // Store ratio
            this.recentRatios.push({ time: catchTime2, ratio });
            if (this.recentRatios.length > 50) {
                this.recentRatios.shift();
            }
        }
    }

    /**
     * Resample stroke data to exactly 100 points via linear interpolation.
     * @private
     */
    _resampleTo100(strokeData) {
        const n = strokeData.length;
        const normalized = [];

        const oldIndices = Array.from({ length: n }, (_, i) => i / (n - 1));
        const newIndices = Array.from({ length: 100 }, (_, i) => i / 99);

        for (let newIdx of newIndices) {
            // Find bracketing indices in oldIndices
            let i = 0;
            while (i < oldIndices.length - 1 && oldIndices[i + 1] < newIdx) {
                i++;
            }

            if (i === oldIndices.length - 1) {
                normalized.push(strokeData[n - 1]);
            } else {
                const t = (newIdx - oldIndices[i]) / (oldIndices[i + 1] - oldIndices[i]);
                const v = strokeData[i] * (1 - t) + strokeData[i + 1] * t;
                normalized.push(v);
            }
        }

        return normalized;
    }

    /**
     * Detect finish index in normalized stroke (0-99).
     * Finish is where drive phase ends and recovery begins.
     * @private
     */
    _detectFinishIdx(normalized) {
        // Find peak in first half (0-50)
        let peakIdx = 0;
        let peakVal = normalized[0];
        for (let i = 0; i < 50 && i < normalized.length; i++) {
            if (normalized[i] > peakVal) {
                peakVal = normalized[i];
                peakIdx = i;
            }
        }

        // Search forward from peak for first local minimum
        for (let i = peakIdx; i < 90 && i < normalized.length - 1; i++) {
            if (normalized[i] < normalized[i + 1]) {
                return i;
            }
        }

        // Fallback: find first slope > -0.02
        for (let i = peakIdx; i < 90 && i < normalized.length - 1; i++) {
            const slope = normalized[i + 1] - normalized[i];
            if (slope > this.FINISH_SLOPE_THRESHOLD) {
                return i;
            }
        }

        // Final fallback: return peak index
        return peakIdx;
    }

    /**
     * Update current SPM based on recent strokes.
     * @private
     */
    _updateSPM() {
        if (this.recentStrokes.length < 2) {
            this.currentSPM = 0;
            return;
        }

        // Compute average stroke time from last few strokes
        const recentCount = Math.min(5, this.recentStrokes.length);
        let totalTime = 0;
        for (let i = this.recentStrokes.length - recentCount; i < this.recentStrokes.length; i++) {
            totalTime += this.recentStrokes[i].duration;
        }

        const avgStrokeTime = totalTime / recentCount;
        this.currentSPM = avgStrokeTime > 0 ? 60.0 / avgStrokeTime : 0;
    }

    /**
     * Get the current SPM (strokes per minute).
     */
    getSPM() {
        return Math.round(this.currentSPM);
    }

    /**
     * Get the most recent stroke's rhythm ratio (drive% / recovery%).
     */
    getLatestRatio() {
        if (this.recentStrokes.length === 0) return null;
        return this.recentStrokes[this.recentStrokes.length - 1].ratio;
    }

    /**
     * Get average ratio over recent strokes.
     */
    getAverageRatio() {
        if (this.recentStrokes.length === 0) return null;
        const sum = this.recentStrokes.reduce((acc, stroke) => acc + stroke.ratio, 0);
        return sum / this.recentStrokes.length;
    }

    /**
     * Get the most recent stroke details.
     */
    getLatestStroke() {
        if (this.recentStrokes.length === 0) return null;
        return this.recentStrokes[this.recentStrokes.length - 1];
    }

    /**
     * Get all recent strokes.
     */
    getRecentStrokes() {
        return [...this.recentStrokes];
    }

    /**
     * Reset detector (clear all state).
     */
    reset() {
        this.emaX.reset();
        this.emaY.reset();
        this.emaZ.reset();
        this.emaChosen.reset();
        this.xBuf.clear();
        this.yBuf.clear();
        this.zBuf.clear();
        this.chosenBuf.clear();
        this.historyBuf.clear();
        this.isBelowThreshold = false;
        this.tempMinVal = Infinity;
        this.tempMinTime = null;
        this.lastCatchTime = null;
        this.recentStrokes = [];
        this.recentRatios = [];
        this.currentSPM = 0;
    }
}
