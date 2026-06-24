// BreatheSensi - Dashboard Controller

// State Management
let currentRoom = 'living_room';
let currentHours = 168; // 1 week by default (All)
let updateInterval = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menuBtn');
const closeBtn = document.getElementById('closeBtn');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const roomList = document.getElementById('roomList');
const currentRoomName = document.getElementById('currentRoomName');
const lastUpdateTime = document.getElementById('lastUpdateTime');
const intervalSlider = document.getElementById('intervalSlider');
const intervalDisplay = document.getElementById('intervalDisplay');
const btnExport = document.getElementById('btnExport');
const btnReset = document.getElementById('btnReset');
const chartLoading = document.getElementById('chartLoading');
const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.getElementById('statusText');

// Value Elements
const valCo2 = document.getElementById('valCo2');
const trendCo2 = document.getElementById('trendCo2');
const predCo2 = document.getElementById('predCo2');

const valTemp = document.getElementById('valTemp');
const trendTemp = document.getElementById('trendTemp');

const valHum = document.getElementById('valHum');
const trendHum = document.getElementById('trendHum');

const valPress = document.getElementById('valPress');
const trendPress = document.getElementById('trendPress');

// Cards references for visibility toggling
const cardCo2 = document.getElementById('cardCo2');
const cardTemp = document.getElementById('cardTemp');
const cardHum = document.getElementById('cardHum');
const cardPress = document.getElementById('cardPress');

// Event Listeners
menuBtn.addEventListener('click', openSidebar);
closeBtn.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// Time buttons click
document.querySelectorAll('.btn-time').forEach(button => {
    button.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-time').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        const minutes = parseInt(button.dataset.minutes);
        // Conversion from minutes picker to hours
        currentHours = minutes === 0 ? 0 : minutes / 60;
        updateDashboard(true); // Force show loading spinner on manual range change
    });
});

// Slider inputs
intervalSlider.oninput = function() {
    intervalDisplay.innerText = this.value + "s";
};

intervalSlider.onchange = async function() {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ interval: parseInt(this.value) })
        });
        setOnlineStatus(true);
    } catch (err) {
        console.error("Failed to save settings", err);
        setOnlineStatus(false);
    }
};

btnReset.addEventListener('click', async () => {
    if (confirm(`Are you sure you want to clear the entire history for room "${currentRoom.replace('_', ' ')}"?`)) {
        try {
            await fetch(`/api/reset?room=${currentRoom}`, { method: 'POST' });
            updateDashboard(true);
        } catch (err) {
            console.error("Failed to reset history", err);
        }
    }
});

// Sidebar Controls
function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
    loadRoomsList();
}

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
}

function setOnlineStatus(online) {
    if (online) {
        statusIndicator.classList.remove('offline');
        statusText.innerText = "Connected";
    } else {
        statusIndicator.classList.add('offline');
        statusText.innerText = "Offline";
    }
}

// Format Name for Display (e.g. living_room -> Living Room)
function formatRoomName(id) {
    return id.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Load dynamic rooms list
async function loadRoomsList() {
    try {
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        setOnlineStatus(true);
        
        roomList.innerHTML = '';
        rooms.forEach(room => {
            const btn = document.createElement('button');
            btn.className = `room-item ${room === currentRoom ? 'active' : ''}`;
            btn.innerHTML = `<span>${formatRoomName(room)}</span>`;
            btn.onclick = () => selectRoom(room);
            roomList.appendChild(btn);
        });
    } catch (err) {
        console.error("Failed to fetch rooms list", err);
        setOnlineStatus(false);
    }
}

// Change active room
function selectRoom(room) {
    currentRoom = room;
    currentRoomName.innerText = formatRoomName(room);
    
    // Update CSV export link
    btnExport.href = `/api/export?room=${room}`;
    
    closeSidebar();
    updateDashboard(true); // Force refresh with spinner
}

// Fetch dashboard data
async function updateDashboard(showSpinner = false) {
    if (showSpinner) chartLoading.classList.add('active');
    
    try {
        const url = `/api/data?room=${currentRoom}&hours=${currentHours}`;
        const res = await fetch(url);
        const data = await res.json();
        setOnlineStatus(true);

        const timestampLength = data.timestamp ? data.timestamp.length : 0;
        
        if (timestampLength > 0) {
            // Update last updated text
            const lastTimeStr = data.timestamp[timestampLength - 1];
            lastUpdateTime.innerText = `Last updated: ${lastTimeStr}`;
            
            // Analyze which sensors are reporting (any non-null values?)
            const hasCo2 = data.co2 && data.co2.some(v => v !== null);
            const hasTemp = data.temp && data.temp.some(v => v !== null);
            const hasHum = data.hum && data.hum.some(v => v !== null);
            const hasPress = data.pressure && data.pressure.some(v => v !== null);
            
            // Toggle card displays
            cardCo2.style.display = hasCo2 ? 'flex' : 'none';
            cardTemp.style.display = hasTemp ? 'flex' : 'none';
            cardHum.style.display = hasHum ? 'flex' : 'none';
            cardPress.style.display = hasPress ? 'flex' : 'none';

            // Calculate trends
            const trends = calculateTrends(data);

            // Update individual stats
            if (hasCo2) {
                const latestCo2 = data.co2[timestampLength - 1];
                valCo2.innerText = Math.round(latestCo2);
                valCo2.className = "value";
                if (latestCo2 < 1000) valCo2.classList.add("good");
                else if (latestCo2 < 1800) valCo2.classList.add("warning");
                else valCo2.classList.add("danger");
                formatTrend('trend-co2', trends.co2, 'ppm', true);
                updatePrediction(latestCo2, trends.co2);
            }

            if (hasTemp) {
                const latestTemp = data.temp[timestampLength - 1];
                valTemp.innerText = latestTemp.toFixed(1);
                formatTrend('trend-temp', trends.temp, '°C', false);
            }

            if (hasHum) {
                const latestHum = data.hum[timestampLength - 1];
                valHum.innerText = Math.round(latestHum);
                formatTrend('trend-hum', trends.hum, '%', false);
            }

            if (hasPress) {
                const latestPress = data.pressure[timestampLength - 1];
                valPress.innerText = Math.round(latestPress);
                formatTrend('trend-press', trends.pressure, 'hPa', false);
            }

            // Draw Chart
            drawChart(data, hasCo2, hasTemp, hasHum, hasPress);
        } else {
            // Empty room state
            valCo2.innerText = "--";
            valTemp.innerText = "--";
            valHum.innerText = "--";
            valPress.innerText = "--";
            lastUpdateTime.innerText = "No data available for this room";
            drawEmptyChart();
        }
    } catch (err) {
        console.error("Error updating dashboard data:", err);
        setOnlineStatus(false);
    } finally {
        chartLoading.classList.remove('active');
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
        const currentVal = arr[len - 1];
        const pastVal = arr[idxPast];
        if (currentVal === null || pastVal === null) return 0;
        return (currentVal - pastVal) / timeDiffMin;
    };

    return {
        co2: getSlope(data.co2),
        temp: getSlope(data.temp),
        hum: getSlope(data.hum),
        pressure: getSlope(data.pressure)
    };
}

// Predict time to 2000ppm limit for CO2
function updatePrediction(currentCo2, slope) {
    const limit = 2000;
    predCo2.className = "prediction-text";

    if (currentCo2 >= limit) {
        predCo2.innerHTML = "STATUS: <b style='color:#ef4444'>STALE AIR</b>";
        return;
    }

    if (slope <= 0.3) {
        predCo2.innerHTML = "Air Quality: <span style='color:#10b981; font-weight:600;'>Stable</span>";
    } else {
        const minutesLeft = (limit - currentCo2) / slope;
        
        if (minutesLeft > 1440) { // More than 24h
            predCo2.innerHTML = "To 2000ppm: &gt; 24h";
        } else {
            const hrs = Math.floor(minutesLeft / 60);
            const mins = Math.floor(minutesLeft % 60);
            const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
            predCo2.innerHTML = `To 2000ppm: <b class="pred-warn">${timeStr}</b>`;
        }
    }
}

// Helper to format trend display arrows
function formatTrend(elemId, val, unit, invertColors) {
    const el = document.getElementById(elemId);
    if (!el) return;
    const arrow = val > 0.02 ? '▲' : (val < -0.02 ? '▼' : '−');
    const absVal = Math.abs(val).toFixed(2); 
    el.innerText = `${arrow} ${absVal} ${unit}/min`;

    el.className = 'trend-indicator';
    if (Math.abs(val) <= 0.02) {
        el.classList.add('trend-neutral');
    } else if (val > 0) {
        el.classList.add(invertColors ? 'trend-up' : 'trend-down'); 
    } else {
        el.classList.add(invertColors ? 'trend-down' : 'trend-up'); 
    }
}

// Convert UTC dates properly for Plotly range configurations
function toLocalISOString(dateObj) {
    const offset = dateObj.getTimezoneOffset() * 60000; 
    const localTime = new Date(dateObj.getTime() - offset);
    return localTime.toISOString().slice(0, 19); 
}

// Render dynamic subplots based on what sensors are reporting in the room
function drawChart(data, hasCo2, hasTemp, hasHum, hasPress) {
    const traces = [];
    
    // Check active layout configuration
    const activeSensors = [];
    if (hasCo2) activeSensors.push({ key: 'co2', name: 'CO2', color: '#a78bfa', yAxisIndex: 1 });
    if (hasTemp) activeSensors.push({ key: 'temp', name: 'Temp', color: '#38bdf8', yAxisIndex: 2 });
    if (hasHum) activeSensors.push({ key: 'hum', name: 'Hum', color: '#34d399', yAxisIndex: 3 });
    if (hasPress) activeSensors.push({ key: 'pressure', name: 'Pressure', color: '#fbbf24', yAxisIndex: 4 });

    const totalSubplots = activeSensors.length;
    if (totalSubplots === 0) {
        drawEmptyChart();
        return;
    }

    // Build Plotly Traces dynamically
    activeSensors.forEach((sensor, index) => {
        // Plotly uses 'y', 'y2', 'y3', 'y4' for multiple axis
        const axisSuffix = index === 0 ? '' : (index + 1);
        traces.push({
            x: data.timestamp,
            y: data[sensor.key],
            name: sensor.name,
            mode: 'lines',
            line: { color: sensor.color, width: 2.5, shape: 'spline' },
            yaxis: 'y' + axisSuffix,
            type: 'scatter'
        });
    });

    // Timeframe range configuration
    let xaxisConfig = { 
        type: 'date', 
        gridcolor: 'rgba(255, 255, 255, 0.05)', 
        linecolor: 'rgba(255, 255, 255, 0.08)',
        fixedrange: true,
        tickcolor: 'rgba(255, 255, 255, 0.2)',
        tickfont: { color: '#9ca3af' }
    };

    if (currentHours > 0 && data.timestamp.length > 0) {
        const lastTime = new Date(data.timestamp[data.timestamp.length - 1]);
        const startTime = new Date(lastTime.getTime() - (currentHours * 3600 * 1000));
        xaxisConfig.range = [toLocalISOString(startTime), toLocalISOString(lastTime)];
    } else {
        xaxisConfig.autorange = true;
    }

    // Dynamic grid layout positioning for Y-Axes
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)', 
        plot_bgcolor: 'rgba(0,0,0,0)', 
        font: { color: '#9ca3af', family: 'Outfit, sans-serif', size: 11 },
        showlegend: false, 
        margin: { t: 10, l: 40, r: 15, b: 40 }, 
        hovermode: 'x unified',
        hoverlabel: {
            bgcolor: '#1f2937',
            bordercolor: '#4b5563',
            font: { color: '#f3f4f6' }
        },
        xaxis: xaxisConfig
    };

    // Calculate Y domains dynamically depending on active tracks
    // E.g., if there are 3 tracks: [0.7, 1.0], [0.35, 0.65], [0.0, 0.3]
    const gap = 0.05;
    const domainHeight = (1 - (gap * (totalSubplots - 1))) / totalSubplots;

    activeSensors.forEach((sensor, index) => {
        const axisSuffix = index === 0 ? '' : (index + 1);
        const yaxisKey = 'yaxis' + axisSuffix;
        
        // Downward positioning: index 0 gets top row, index N gets bottom row
        const domainStart = 1 - ((index + 1) * domainHeight) - (index * gap);
        const domainEnd = 1 - (index * domainHeight) - (index * gap);
        
        layout[yaxisKey] = {
            domain: [Math.max(0, domainStart), Math.min(1, domainEnd)],
            gridcolor: 'rgba(255, 255, 255, 0.04)',
            linecolor: 'rgba(255, 255, 255, 0.08)',
            tickcolor: 'rgba(255, 255, 255, 0.2)',
            fixedrange: true,
            zeroline: false
        };
    });

    Plotly.react('chart', traces, layout, { responsive: true, displayModeBar: false });
}

function drawEmptyChart() {
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)', 
        plot_bgcolor: 'rgba(0,0,0,0)',
        xaxis: { visible: false },
        yaxis: { visible: false },
        annotations: [{
            text: "No data logs found in selected range",
            xref: "paper", yref: "paper",
            showarrow: false,
            font: { color: '#6b7280', size: 14 }
        }]
    };
    Plotly.react('chart', [], layout, { responsive: true, displayModeBar: false });
}

// Initial Core Load
async function init() {
    currentRoomName.innerText = formatRoomName(currentRoom);
    btnExport.href = `/api/export?room=${currentRoom}`;
    
    // Load config settings
    try {
        const configRes = await fetch('/api/settings');
        const config = await configRes.json();
        intervalSlider.value = config.interval;
        intervalDisplay.innerText = config.interval + "s";
    } catch (err) {
        console.error("Could not fetch configurations", err);
    }
    
    // Get rooms list initially
    await loadRoomsList();
    
    // Initial paint
    await updateDashboard(true);
    
    // Polling triggers every 10 seconds (optimized from 5 to reduce server cycles)
    updateInterval = setInterval(() => {
        updateDashboard(false); // background fetch, no spinner
    }, 10000);
}

init();
