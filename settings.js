import { state } from './globals.js';

export function initSettings() {
    const modal = document.getElementById('modal-overlay');
    const selectType = document.getElementById('setup-type');
    const inputVal = document.getElementById('setup-val');
    const valGroup = document.getElementById('val-group');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const btnSettings = document.getElementById('btn-settings');

    btnSettings.addEventListener('click', () => {
        if (!state.isRunning) modal.classList.remove('hidden');
    });

    selectType.addEventListener('change', () => {
        if (selectType.value === 'free') {
            valGroup.classList.add('hidden');
        } else {
            valGroup.classList.remove('hidden');
            if (selectType.value === 'distance') {
                document.getElementById('val-label').innerText = 'Distance (meters):';
                inputVal.placeholder = 'e.g. 1000';
            } else {
                document.getElementById('val-label').innerText = 'Time (minutes):';
                inputVal.placeholder = 'e.g. 5';
            }
        }
    });

    btnSaveSettings.addEventListener('click', () => {
        state.targetType = selectType.value;
        if (state.targetType === 'distance') {
            state.targetValue = parseInt(inputVal.value) || 1000;
        } else if (state.targetType === 'time') {
            state.targetValue = (parseFloat(inputVal.value) || 1) * 60000;
        } else {
            state.targetValue = 0;
        }
        state.intervalState = 'work';
        modal.classList.add('hidden');
        // Dispatch a simple event so app can update labels immediately
        window.dispatchEvent(new Event('settings:updated'));
    });
}

export function getSettings() {
    return {
        targetType: state.targetType,
        targetValue: state.targetValue,
        intervalState: state.intervalState
    };
}
