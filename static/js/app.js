// State Management
let currentRoom = 'living_room';
let currentHours = 24; // default to 24 (1D)
let currentMetric = 'co2'; // default metric to plot
let updateInterval = null;

// DOM Elements
const menuBtn = document.getElementById('menuBtn');
const roomDrawer = document.getElementById('roomDrawer');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const drawerOverlay = document.getElementById('drawerOverlay');
const roomList = document.getElementById('roomList');
const currentRoomName = document.getElementById('currentRoomName');
const statusIndicator = document.getElementById('statusIndicator');

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
menuBtn.onclick = openDrawer;
closeDrawerBtn.onclick = closeDrawer;
drawerOverlay.onclick = closeDrawer;

function openDrawer() {
    roomDrawer.classList.add('open');
    drawerOverlay.classList.add('active');
    drawerOverlay.style.display = 'block';
    setTimeout(() => {
        drawerOverlay.style.opacity = '1';
    }, 10);
    loadRoomsList();
}

function closeDrawer() {
    roomDrawer.classList.remove('open');
    drawerOverlay.classList.remove('active');
    drawerOverlay.style.opacity = '0';
    setTimeout(() => {
        if (!roomDrawer.classList.contains('open')) {
            drawerOverlay.style.display = 'none';
        }
    }, 250);
}

// Set Connection status
function setStatus(online, isWarmingUp = false, remainingSec = 0) {
    statusIndicator.classList.remove('offline', 'warming-up');
    const label = document.getElementById('statusLabel');
    
    if (!online) {
        statusIndicator.classList.add('offline');
        if (label) label.innerText = 'Offline';
    } else if (isWarmingUp) {
        statusIndicator.classList.add('warming-up');
        if (label) {
            const min = Math.ceil(remainingSec / 60);
            label.innerText = `Warming up (${min}m)`;
        }
    } else {
        if (label) label.innerText = 'Online';
    }
}

// Format ID (e.g. living_room -> Living Room)
function formatRoomName(id) {
    return id.split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// Helper to calculate relative last seen time
function timeAgo(dateString) {
    if (!dateString) return "No data";
    const t = dateString.split(/[- :]/);
    const date = new Date(t[0], t[1]-1, t[2], t[3], t[4], t[5]);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
}

// Format mapping
let activeRoomNameMap = {"living_room": "Living Room"};

// Load Rooms list
async function loadRoomsList() {
    try {
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        setStatus(true);
        
        roomList.innerHTML = '';
        activeRoomNameMap = {};
        
        rooms.forEach(room => {
            activeRoomNameMap[room.id] = room.name;
            
            // Container representing the list row item
            const itemContainer = document.createElement('div');
            itemContainer.style.display = 'flex';
            itemContainer.style.alignItems = 'center';
            itemContainer.style.justifyContent = 'space-between';
            itemContainer.style.background = '#252525';
            itemContainer.style.border = '1px solid #333';
            itemContainer.style.borderRadius = '6px';
            itemContainer.style.padding = '4px 10px';
            itemContainer.style.gap = '8px';
            
            if (room.id === currentRoom) {
                itemContainer.style.borderColor = '#4da6ff';
            }

            // Calculate status (Active if seen in last 5 minutes)
            const t = room.last_seen.split(/[- :]/);
            const lastSeenDate = new Date(t[0], t[1]-1, t[2], t[3], t[4], t[5]);
            const diffMin = Math.floor((new Date().getTime() - lastSeenDate.getTime()) / 60000);
            const isActive = diffMin < 5; // 5 min threshold for sleep nodes

            const isWarmingUp = room.is_warming_up || false;
            const remainingSec = room.remaining_seconds || 0;

            const dot = document.createElement('span');
            dot.style.width = '8px';
            dot.style.height = '8px';
            dot.style.borderRadius = '50%';
            
            if (isWarmingUp) {
                dot.style.backgroundColor = '#ffb84d';
                dot.style.boxShadow = '0 0 6px #ffb84d';
            } else {
                dot.style.backgroundColor = isActive ? '#4dff88' : '#666';
                if (isActive) {
                    dot.style.boxShadow = '0 0 6px #4dff88';
                }
            }

            // Clickable text item to switch active dashboard room
            const btn = document.createElement('div');
            btn.className = `room-item-btn`;
            
            let statusText = timeAgo(room.last_seen);
            let statusStyle = 'font-size: 0.7rem; color: #555; font-weight: normal; margin-left: 4px;';
            if (isWarmingUp) {
                const min = Math.ceil(remainingSec / 60);
                statusText = `Warming up ${min}m`;
                statusStyle = 'font-size: 0.7rem; color: #ffb84d; font-weight: 500; margin-left: 4px;';
            }
            btn.innerHTML = `${room.name} <span style="${statusStyle}">(${statusText})</span>`;
            btn.style.flex = '1';
            btn.style.padding = '6px 4px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '0.85rem';
            btn.style.fontWeight = '600';
            btn.style.color = room.id === currentRoom ? '#fff' : '#aaa';
            
            btn.onclick = () => {
                currentRoom = room.id;
                currentRoomName.innerText = room.name;
                btnExport.href = `/api/export?room=${room.id}`;
                closeDrawer();
                updateDashboard(true);
            };

            // Pencil edit icon button to rename aliases dynamically
            const renameBtn = document.createElement('button');
            renameBtn.innerHTML = '✏️';
            renameBtn.style.background = 'none';
            renameBtn.style.border = 'none';
            renameBtn.style.cursor = 'pointer';
            renameBtn.style.fontSize = '0.75rem';
            renameBtn.style.padding = '6px';
            renameBtn.style.opacity = '0.6';
            renameBtn.title = "Rename";
            renameBtn.onclick = async (e) => {
                e.stopPropagation();
                const newName = prompt(`Enter new name for room "${room.name}":`, room.name);
                if (newName && newName.trim() !== "") {
                    try {
                        await fetch('/api/rename', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({id: room.id, name: newName.trim()})
                        });
                        if (currentRoom === room.id) {
                            currentRoomName.innerText = newName.trim();
                        }
                        loadRoomsList();
                    } catch (err) {
                        console.error(err);
                    }
                }
            };
            renameBtn.onmouseenter = () => { renameBtn.style.opacity = '1'; };
            renameBtn.onmouseleave = () => { renameBtn.style.opacity = '0.6'; };

            itemContainer.appendChild(dot);
            itemContainer.appendChild(btn);
            itemContainer.appendChild(renameBtn);
            roomList.appendChild(itemContainer);
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

// Reset settings
btnReset.onclick = async function() {
    const displayName = activeRoomNameMap[currentRoom] || formatRoomName(currentRoom);
    if (confirm(`Opravdu chcete smazat místnost "${displayName}" a veškerou její historii?`)) {
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
        const isWarmingUp = data.is_warming_up || false;
        const remainingSec = data.remaining_seconds || 0;
        setStatus(true, isWarmingUp, remainingSec);
        
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

// Renders single trace graph
function drawChart(data, hasCo2, hasTemp, hasHum, hasPress) {
    // Fallback if the selected metric is not available in the current room
    let metric = currentMetric;
    if (metric === 'co2' && !hasCo2) metric = hasTemp ? 'temp' : (hasHum ? 'hum' : 'pressure');
    if (metric === 'temp' && !hasTemp) metric = hasCo2 ? 'co2' : (hasHum ? 'hum' : 'pressure');
    if (metric === 'hum' && !hasHum) metric = hasCo2 ? 'co2' : (hasTemp ? 'temp' : 'pressure');
    if (metric === 'pressure' && !hasPress) metric = hasCo2 ? 'co2' : (hasTemp ? 'temp' : 'hum');
    
    currentMetric = metric;

    // Toggle button active styling & visibility
    document.querySelectorAll('.btn-metric').forEach(btn => {
        const m = btn.dataset.metric;
        btn.classList.toggle('active', m === currentMetric);
        
        if (m === 'co2') btn.style.display = hasCo2 ? 'inline-block' : 'none';
        if (m === 'temp') btn.style.display = hasTemp ? 'inline-block' : 'none';
        if (m === 'hum') btn.style.display = hasHum ? 'inline-block' : 'none';
        if (m === 'pressure') btn.style.display = hasPress ? 'inline-block' : 'none';
    });

    const configs = {
        co2: { name: 'CO2', color: '#ff4d4d', unit: 'ppm' },
        temp: { name: 'Teplota', color: '#4da6ff', unit: '°C' },
        hum: { name: 'Vlhkost', color: '#4dff88', unit: '%' },
        pressure: { name: 'Tlak', color: '#ffb84d', unit: 'hPa' }
    };

    const activeConfig = configs[currentMetric];
    if (!activeConfig || !data[currentMetric]) {
        drawEmptyChart();
        return;
    }

    const trace = {
        x: data.timestamp,
        y: data[currentMetric],
        name: activeConfig.name,
        mode: 'lines+markers',
        type: 'scatter',
        line: { color: activeConfig.color, width: 2 },
        marker: { size: 3 }
    };

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
        margin: { t: 20, l: 45, r: 15, b: 40 }, 
        hovermode: 'x unified',
        hoverlabel: {
            bgcolor: '#1e1e1e',
            bordercolor: '#333'
        },
        xaxis: xaxisConfig,
        yaxis: {
            gridcolor: '#222',
            fixedrange: true,
            zeroline: false,
            title: activeConfig.unit
        }
    };

    Plotly.react('chart', [trace], layout, { responsive: true, displayModeBar: false });
}

function drawEmptyChart() {
    const layout = {
        paper_bgcolor: '#121212',
        plot_bgcolor: '#121212',
        xaxis: { visible: false },
        yaxis: { visible: false },
        annotations: [{
            text: "No data in this period",
            xref: "paper", yref: "paper",
            showarrow: false,
            font: { color: '#666', size: 12 }
        }]
    };
    Plotly.react('chart', [], layout, { responsive: true, displayModeBar: false });
}

// Initial script bootstrap
async function init() {
    // Bind Metric Tabs
    document.querySelectorAll('.btn-metric').forEach(btn => {
        btn.onclick = function() {
            currentMetric = this.dataset.metric;
            updateDashboard(true);
        };
    });

    // Load rooms mapping lists first to resolve display title name correctly on boot
    await loadRoomsList();
    currentRoomName.innerText = activeRoomNameMap[currentRoom] || formatRoomName(currentRoom);
    btnExport.href = `/api/export?room=${currentRoom}`;
    
    // Initial fetch
    await updateDashboard(true);
    
    // Set periodic polling
    updateInterval = setInterval(() => updateDashboard(false), 5000);
}

// --- TOUCH SWIPE GESTURES FOR MOBILE ---
let touchStartX = 0;
let touchStartY = 0;
let isDragging = false;
const drawerWidth = 260; // matching CSS transform offset

document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    const isOpen = roomDrawer.classList.contains('open');
    
    // Skip if touching sliders or the plotly chart area to avoid locking control inputs
    if (e.target.closest('input[type=range]') || e.target.closest('.plotly-chart')) {
        return;
    }

    if (!isOpen && touch.clientX < 45) {
        // Start dragging to pull open from left edge
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        isDragging = true;
        roomDrawer.style.transition = 'none';
        drawerOverlay.style.transition = 'none';
        drawerOverlay.style.display = 'block';
        drawerOverlay.style.opacity = '0';
        drawerOverlay.classList.add('active');
    } else if (isOpen) {
        // Start dragging to push close (anywhere on screen)
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        isDragging = true;
        roomDrawer.style.transition = 'none';
        drawerOverlay.style.transition = 'none';
    }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    
    const isOpen = roomDrawer.classList.contains('open');
    
    // Cancel swipe detection if user is scrolling vertically on a closed drawer
    if (!isOpen && Math.abs(deltaY) > Math.abs(deltaX)) {
        isDragging = false;
        drawerOverlay.classList.remove('active');
        drawerOverlay.style.display = 'none';
        roomDrawer.style.transform = '';
        return;
    }
    
    if (!isOpen) {
        // Pulling open: transform goes from -260px towards 0px
        let tx = -drawerWidth + deltaX;
        if (tx > 0) tx = 0;
        if (tx < -drawerWidth) tx = -drawerWidth;
        
        roomDrawer.style.transform = `translateX(${tx}px)`;
        const progress = (tx + drawerWidth) / drawerWidth;
        drawerOverlay.style.opacity = progress * 0.6;
    } else {
        // Pushing close: transform goes from 0px towards -260px
        let tx = deltaX;
        if (tx > 0) tx = 0;
        if (tx < -drawerWidth) tx = -drawerWidth;
        
        roomDrawer.style.transform = `translateX(${tx}px)`;
        const progress = (drawerWidth + tx) / drawerWidth;
        drawerOverlay.style.opacity = progress * 0.6;
    }
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;
    
    // Reset transition animations
    roomDrawer.style.transition = '';
    drawerOverlay.style.transition = '';
    
    const isOpen = roomDrawer.classList.contains('open');
    const transformStr = roomDrawer.style.transform;
    
    // Reset inline styles
    roomDrawer.style.transform = '';
    drawerOverlay.style.opacity = '';
    
    if (transformStr) {
        const match = transformStr.match(/translateX\(([-\d.]+)px\)/);
        if (match) {
            const currentTx = parseFloat(match[1]);
            if (!isOpen) {
                // If pulled out more than 80px, open it
                if (currentTx > -180) {
                    openDrawer();
                } else {
                    closeDrawer();
                }
            } else {
                // If pushed closed more than 80px, close it
                if (currentTx < -80) {
                    closeDrawer();
                } else {
                    openDrawer();
                }
            }
        }
    }
});

init();
