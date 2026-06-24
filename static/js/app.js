// State Management
let currentRoom = 'living_room';
let currentHours = 168; // default to 168 (All)
let updateInterval = null;

// DOM Elements
const menuBtn = document.getElementById('menuBtn');
const roomDrawer = document.getElementById('roomDrawer');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const drawerOverlay = document.getElementById('drawerOverlay');
const roomList = document.getElementById('roomList');
const currentRoomName = document.getElementById('currentRoomName');
const statusIndicator = document.getElementById('statusIndicator');

const slider = document.getElementById('interval-slider');
const intervalDisplay = document.getElementById('interval-display');
const btnExport = document.getElementById('btnExport');
const btnReset = document.getElementById('btnReset');
const chartLoader = document.getElementById('chartLoader');

// Stats Elements
const valCo2 = document.getElementById('val-co2');
const trendCo2 = document.getElementById('trend-co2');
const predCo2 = document.getElementById('pred-co2');

const valTemp = document.getElementById('val-temp');
const trendTemp = document.getElementById('trend-temp');

const valHum = document.getElementById('val-hum');
const trendHum = document.getElementById('trend-hum');

const valPress = document.getElementById('val-press');
const trendPress = document.getElementById('trend-press');

// Cards for Toggling Visibility
const cardCo2 = document.getElementById('cardCo2');
const cardTemp = document.getElementById('cardTemp');
const cardHum = document.getElementById('cardHum');
const cardPress = document.getElementById('cardPress');

// --- DRAWER CONTROLS ---
menuBtn.onclick = function() {
    roomDrawer.classList.add('open');
    drawerOverlay.classList.add('active');
    loadRoomsList();
};

closeDrawerBtn.onclick = closeDrawer;
drawerOverlay.onclick = closeDrawer;

function closeDrawer() {
    roomDrawer.classList.remove('open');
    drawerOverlay.classList.remove('active');
}

// Set Connection status
function setStatus(online) {
    if (online) {
        statusIndicator.classList.remove('offline');
    } else {
        statusIndicator.classList.add('offline');
    }
}

// Format ID (e.g. living_room -> Living Room)
function formatRoomName(id) {
    return id.split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// Load Rooms list
async function loadRoomsList() {
    try {
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        setStatus(true);
        
        roomList.innerHTML = '';
        rooms.forEach(room => {
            const btn = document.createElement('div');
            btn.className = `room-item ${room === currentRoom ? 'active' : ''}`;
            btn.innerText = formatRoomName(room);
            btn.onclick = () => {
                currentRoom = room;
                currentRoomName.innerText = formatRoomName(room);
                btnExport.href = `/api/export?room=${room}`;
                closeDrawer();
                updateDashboard(true);
            };
            roomList.appendChild(btn);
        });
    } catch (err) {
        console.error(err);
        setStatus(false);
    }
}

// Time Range Settings
document.querySelectorAll('.btn-time').forEach(btn => {
    btn.onclick = function() {
        document.querySelectorAll('.btn-time').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        const minutes = parseInt(this.dataset.minutes);
        currentHours = minutes === 0 ? 0 : minutes / 60;
        updateDashboard(true);
    };
});

// Slider settings
slider.oninput = function() { intervalDisplay.innerText = this.value + "s"; };
slider.onchange = async function() {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({interval: parseInt(this.value)})
        });
        setStatus(true);
    } catch (err) {
        console.error(err);
        setStatus(false);
    }
};

// Reset settings
btnReset.onclick = async function() {
    if (confirm(`Smazat veškerou historii pro místnost "${formatRoomName(currentRoom)}"?`)) {
        try {
            await fetch(`/api/reset?room=${currentRoom}`, { method: 'POST' });
            updateDashboard(true);
        } catch (err) {
            console.error(err);
        }
    }
};

// --- UPDATE DASHBOARD ---
async function updateDashboard(forceSpinner = false) {
    if (forceSpinner) chartLoader.classList.add('active');
    
    try {
        const res = await fetch(`/api/data?room=${currentRoom}&hours=${currentHours}`);
        const data = await res.json();
        setStatus(true);
        
        const length = data.timestamp ? data.timestamp.length : 0;
        
        if (length > 0) {
            // Determine active parameters
            const hasCo2 = data.co2 && data.co2.some(v => v !== null);
            const hasTemp = data.temp && data.temp.some(v => v !== null);
            const hasHum = data.hum && data.hum.some(v => v !== null);
            const hasPress = data.pressure && data.pressure.some(v => v !== null);
            
            // Toggle card UI element displays
            cardCo2.style.display = hasCo2 ? 'flex' : 'none';
            cardTemp.style.display = hasTemp ? 'flex' : 'none';
            cardHum.style.display = hasHum ? 'flex' : 'none';
            cardPress.style.display = hasPress ? 'flex' : 'none';
            
            const trends = calculateTrends(data);
            
            if (hasCo2) {
                const lastCo2 = data.co2[length - 1];
                valCo2.innerText = Math.round(lastCo2);
                
                valCo2.className = "value";
                if (lastCo2 < 1000) valCo2.classList.add("good");
                else if (lastCo2 < 1800) valCo2.classList.add("warning");
                else valCo2.classList.add("danger");
                
                formatTrend('trend-co2', trends.co2, 'ppm', true);
                updatePrediction(lastCo2, trends.co2);
            }
            
            if (hasTemp) {
                valTemp.innerText = data.temp[length - 1].toFixed(1);
                formatTrend('trend-temp', trends.temp, '°C', false);
            }
            
            if (hasHum) {
                valHum.innerText = data.hum[length - 1].toFixed(0);
                formatTrend('trend-hum', trends.hum, '%', false);
            }
            
            if (hasPress) {
                valPress.innerText = data.pressure[length - 1].toFixed(0);
                formatTrend('trend-press', trends.pressure, 'hPa', false);
            }
            
            drawChart(data, hasCo2, hasTemp, hasHum, hasPress);
        } else {
            valCo2.innerText = "--";
            valTemp.innerText = "--";
            valHum.innerText = "--";
            valPress.innerText = "--";
            drawEmptyChart();
        }
        
    } catch (err) {
        console.error(err);
        setStatus(false);
    } finally {
        chartLoader.classList.remove('active');
    }
}

// Calculate slope in units/min over the last 5 minutes
function calculateTrends(data) {
    const len = data.timestamp.length;
    if (len < 2) return { co2: 0, temp: 0, hum: 0, pressure: 0 };

    const now = new Date(data.timestamp[len - 1]).getTime();
    const lookbackMs = 5 * 60 * 1000; // 5 min
    
    let idxPast = len - 2;
    for (let i = len - 2; i >= 0; i--) {
        const t = new Date(data.timestamp[i]).getTime();
        if (now - t >= lookbackMs) {
            idxPast = i;
            break;
        }
    }

    const pastTime = new Date(data.timestamp[idxPast]).getTime();
    const timeDiffMin = (now - pastTime) / 60000; 

    if (timeDiffMin <= 0) return { co2: 0, temp: 0, hum: 0, pressure: 0 };

    const getSlope = (arr) => {
        const valNow = arr[len - 1];
        const valPast = arr[idxPast];
        if (valNow === null || valPast === null) return 0;
        return (valNow - valPast) / timeDiffMin;
    };

    return {
        co2: getSlope(data.co2),
        temp: getSlope(data.temp),
        hum: getSlope(data.hum),
        pressure: getSlope(data.pressure)
    };
}

// Calculate predictive air status
function updatePrediction(currentCo2, slope) {
    const limit = 2000;
    predCo2.className = "prediction";

    if (currentCo2 >= limit) {
        predCo2.innerHTML = "STATUS: <b style='color:#ff4d4d'>STALE AIR</b>";
        return;
    }

    if (slope <= 0.5) {
        predCo2.innerHTML = "Air Quality: Stable";
        predCo2.style.color = "#4dff88";
    } else {
        const minutesLeft = (limit - currentCo2) / slope;
        if (minutesLeft > 1440) {
            predCo2.innerHTML = "To 2000ppm: > 24h";
        } else {
            const hrs = Math.floor(minutesLeft / 60);
            const mins = Math.floor(minutesLeft % 60);
            const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
            predCo2.innerHTML = `To 2000ppm: <b class="pred-warn">${timeStr}</b>`;
        }
    }
}

// Formats display arrows for trend vectors
function formatTrend(elemId, val, unit, invertColors) {
    const el = document.getElementById(elemId);
    if (!el) return;
    const arrow = val > 0.05 ? '▲' : (val < -0.05 ? '▼' : '−');
    const absVal = Math.abs(val).toFixed(1); 
    el.innerText = `${arrow} ${absVal} ${unit}/min`;

    el.className = 'trend';
    if (Math.abs(val) <= 0.05) el.classList.add('trend-neutral');
    else if (val > 0) el.classList.add(invertColors ? 'trend-up' : 'trend-down'); 
    else el.classList.add(invertColors ? 'trend-down' : 'trend-up'); 
}

// Converts UTC timestamps correctly for Plotly
function toLocalISOString(dateObj) {
    const offset = dateObj.getTimezoneOffset() * 60000; 
    const localTime = new Date(dateObj.getTime() - offset);
    return localTime.toISOString().slice(0, 19); 
}

// Renders Graph using clean classic dark grids
function drawChart(data, hasCo2, hasTemp, hasHum, hasPress) {
    const traces = [];
    const activePlots = [];
    
    if (hasCo2) activePlots.push({ key: 'co2', name: 'CO2', color: '#ff4d4d' });
    if (hasTemp) activePlots.push({ key: 'temp', name: 'Temp', color: '#4da6ff' });
    if (hasHum) activePlots.push({ key: 'hum', name: 'Hum', color: '#4dff88' });
    if (hasPress) activePlots.push({ key: 'pressure', name: 'Pressure', color: '#ffb84d' });

    const totalSubplots = activePlots.length;
    if (totalSubplots === 0) {
        drawEmptyChart();
        return;
    }

    activePlots.forEach((plot, idx) => {
        const suffix = idx === 0 ? '' : (idx + 1);
        traces.push({
            x: data.timestamp,
            y: data[plot.key],
            name: plot.name,
            mode: 'lines+markers',
            type: 'scatter',
            line: { color: plot.color, width: 2 },
            marker: { size: 3 },
            yaxis: 'y' + suffix
        });
    });

    let xaxisConfig = { 
        type: 'date', 
        gridcolor: '#222', 
        fixedrange: true,
        tickfont: { color: '#888' }
    };

    if (currentHours > 0 && data.timestamp.length > 0) {
        const lastTime = new Date(data.timestamp[data.timestamp.length - 1]);
        const startTime = new Date(lastTime.getTime() - (currentHours * 3600 * 1000));
        xaxisConfig.range = [toLocalISOString(startTime), toLocalISOString(lastTime)];
    } else {
        xaxisConfig.autorange = true;
    }

    const layout = {
        paper_bgcolor: '#121212', 
        plot_bgcolor: '#121212', 
        font: { color: '#999', size: 10, family: 'sans-serif' },
        showlegend: false, 
        margin: { t: 20, l: 40, r: 15, b: 40 }, 
        hovermode: 'x unified',
        hoverlabel: {
            bgcolor: '#1e1e1e',
            bordercolor: '#333'
        },
        xaxis: xaxisConfig
    };

    const gap = 0.04;
    const height = (1.0 - (gap * (totalSubplots - 1))) / totalSubplots;

    activePlots.forEach((plot, idx) => {
        const suffix = idx === 0 ? '' : (idx + 1);
        const yKey = 'yaxis' + suffix;
        const start = 1.0 - ((idx + 1) * height) - (idx * gap);
        const end = 1.0 - (idx * height) - (idx * gap);

        layout[yKey] = {
            domain: [Math.max(0, start), Math.min(1.0, end)],
            gridcolor: '#222',
            fixedrange: true,
            zeroline: false
        };
    });

    Plotly.react('chart', traces, layout, { responsive: true, displayModeBar: false });
}

function drawEmptyChart() {
    const layout = {
        paper_bgcolor: '#121212',
        plot_bgcolor: '#121212',
        xaxis: { visible: false },
        yaxis: { visible: false },
        annotations: [{
            text: "Žádná data v tomto období",
            xref: "paper", yref: "paper",
            showarrow: false,
            font: { color: '#666', size: 12 }
        }]
    };
    Plotly.react('chart', [], layout, { responsive: true, displayModeBar: false });
}

// Initial script bootstrap
async function init() {
    currentRoomName.innerText = formatRoomName(currentRoom);
    btnExport.href = `/api/export?room=${currentRoom}`;
    
    try {
        const configRes = await fetch('/api/settings');
        const config = await configRes.json();
        slider.value = config.interval;
        intervalDisplay.innerText = config.interval + "s";
    } catch (err) {
        console.error(err);
    }
    
    // Initial fetch
    await updateDashboard(true);
    
    // Set periodic polling
    updateInterval = setInterval(() => updateDashboard(false), 5000);
}

init();
