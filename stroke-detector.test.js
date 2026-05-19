/**
 * Test suite for StrokeDetector
 * Tests synthetic stroke waveforms and validates detection accuracy.
 */

import { StrokeDetector } from './stroke-detector.js';

/**
 * Synthetic rowing stroke waveform.
 * Simplified parabolic model: drive phase is a bell curve, recovery is linear decay.
 */
function generateSyntheticStroke(durationSec, driveFraction = 0.3, noiseLevel = 0.1, fs = 100) {
    const samples = Math.floor(durationSec * fs);
    const data = [];

    const driveEnd = Math.floor(samples * driveFraction);

    for (let i = 0; i < samples; i++) {
        let value;
        if (i < driveEnd) {
            // Drive phase: parabolic peak
            const t = i / driveEnd;
            value = Math.sin(t * Math.PI) * 2.0; // Peak amplitude ~2.0
        } else {
            // Recovery phase: linear decay back to baseline
            const recPercent = (i - driveEnd) / (samples - driveEnd);
            value = 2.0 * (1 - recPercent) * 0.5; // Gradual fall
        }

        // Add noise
        const noise = (Math.random() - 0.5) * noiseLevel;
        data.push(value + noise);
    }

    return data;
}

/**
 * Simple test: single synthetic stroke.
 */
export function testSyntheticStroke() {
    console.log('\n=== Test: Synthetic Stroke ===');
    const detector = new StrokeDetector({ FS: 100 });
    const strokeData = generateSyntheticStroke(2.0, 0.35, 0.05);

    let t = 0;
    for (let value of strokeData) {
        // Use Z-axis for stroke (simulate rower pulling up)
        detector.process(t / 100, 0, 0, value);
        t += 1;
    }

    const spm = detector.getSPM();
    const latestStroke = detector.getLatestStroke();

    console.log(`Detected SPM: ${spm}`);
    console.log(`Recent strokes count: ${detector.getRecentStrokes().length}`);

    if (latestStroke) {
        console.log(`Latest stroke finish index: ${latestStroke.finishIdx}`);
        console.log(`Drive %: ${latestStroke.drivePct.toFixed(1)}`);
        console.log(`Recovery %: ${latestStroke.recoveryPct.toFixed(1)}`);
        console.log(`Rhythm ratio: ${latestStroke.ratio.toFixed(2)}`);
    }

    // Basic validation
    if (spm > 0 && spm <= 90) {
        console.log('✓ SPM is in valid range');
    } else {
        console.log(`✗ SPM out of range: ${spm}`);
    }

    if (latestStroke && latestStroke.finishIdx > 20 && latestStroke.finishIdx < 80) {
        console.log('✓ Finish index is reasonable');
    } else if (!latestStroke) {
        console.log('✗ No stroke detected');
    }
}

/**
 * Test: multiple strokes at different rates.
 */
export function testMultipleStrokes() {
    console.log('\n=== Test: Multiple Strokes (variable rate) ===');
    const detector = new StrokeDetector({ FS: 100, MIN_STROKE_TIME_SEC: 0.8 });

    let t = 0;

    // 5 strokes at varying durations
    for (let stroke = 0; stroke < 5; stroke++) {
        const duration = 1.5 + stroke * 0.3; // Slowing down
        const strokeData = generateSyntheticStroke(duration, 0.35, 0.08, 100);

        for (let value of strokeData) {
            detector.process(t / 100, 0, value, 0); // Use Y-axis
            t += 1;
        }
    }

    console.log(`Detected strokes: ${detector.getRecentStrokes().length}`);
    console.log(`Current SPM: ${detector.getSPM()}`);
    console.log(`Average rhythm ratio: ${detector.getAverageRatio()?.toFixed(2)}`);

    if (detector.getRecentStrokes().length >= 3) {
        console.log('✓ Multiple strokes detected');
    } else {
        console.log(`✗ Expected >= 3 strokes, got ${detector.getRecentStrokes().length}`);
    }
}

/**
 * Test: detector with noise and axis switching.
 */
export function testDominantAxisSwitch() {
    console.log('\n=== Test: Dominant Axis Selection ===');
    const detector = new StrokeDetector({ FS: 100, DOM_EVAL_PERIOD: 0.5 });

    let t = 0;

    // Feed 20 seconds of data with Z-axis dominant, then X-axis
    for (let sec = 0; sec < 20; sec++) {
        for (let i = 0; i < 100; i++) {
            let ax, ay, az;

            if (sec < 10) {
                // Z-axis dominant
                const noiseZ = (Math.random() - 0.5) * 0.5;
                az = Math.sin((t / 100) * 2 * Math.PI / 1.5) + noiseZ; // 1.5s period
                ax = (Math.random() - 0.5) * 0.3; // Low noise
                ay = (Math.random() - 0.5) * 0.3;
            } else {
                // X-axis dominant
                const noiseX = (Math.random() - 0.5) * 0.5;
                ax = Math.sin((t / 100) * 2 * Math.PI / 1.5) + noiseX;
                ay = (Math.random() - 0.5) * 0.3;
                az = (Math.random() - 0.5) * 0.3;
            }

            detector.process(t / 100, ax, ay, az);
            t += 1;
        }
    }

    console.log(`Detected SPM: ${detector.getSPM()}`);
    console.log(`Detected strokes: ${detector.getRecentStrokes().length}`);

    if (detector.getRecentStrokes().length > 0) {
        console.log('✓ Strokes detected with axis switching');
    }
}

/**
 * Run all tests.
 */
export function runAllTests() {
    console.log('========== STROKE DETECTOR TESTS ==========');
    testSyntheticStroke();
    testMultipleStrokes();
    testDominantAxisSwitch();
    console.log('\n========== TESTS COMPLETE ==========\n');
}

// Uncomment to run tests in Node.js or browser console:
// runAllTests();
