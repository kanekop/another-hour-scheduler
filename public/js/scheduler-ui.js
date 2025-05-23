// public/js/scheduler-ui.js

import { getCustomAhAngles } from '../clock-core.js';
import { getCurrentScalingInfo } from './scaling-utils.js';

// Constants
const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// State
const state = {
  currentWeekStart: null,
  timeMode: 'ah', // 'ah', 'real', or 'both'
  events: [],
  selectedTimezone: null,
  isAuthenticated: false,
  normalAphDayDurationMinutes: 1380, // Default 23 hours
  scaleFactor: 24/23
};

// DOM Elements
const elements = {
  calendarGrid: document.getElementById('calendar-grid'),
  currentWeekDisplay: document.getElementById('current-week-display'),
  prevWeekBtn: document.getElementById('prev-week'),
  nextWeekBtn: document.getElementById('next-week'),
  syncStatus: document.getElementById('sync-status'),
  syncCalendarBtn: document.getElementById('sync-calendar-btn'),
  eventDetails: document.getElementById('event-details'),
  eventInfo: document.getElementById('event-info'),
  timeModeRadios: document.querySelectorAll('input[name="time-mode"]')
};

// Initialize
function initialize() {
  // Get user's timezone
  state.selectedTimezone = localStorage.getItem('personalizedAhSelectedTimezone') || moment.tz.guess() || 'UTC';

  // Get AH duration from localStorage
  const savedDuration = localStorage.getItem('personalizedAhDurationMinutes');
  if (savedDuration) {
    state.normalAphDayDurationMinutes = parseInt(savedDuration, 10);
  }

  // Calculate scale factor
  updateScaleFactor();

  // Set current week
  const now = moment().tz(state.selectedTimezone);
  state.currentWeekStart = now.clone().startOf('week');

  // Set up event listeners
  setupEventListeners();

  // Check authentication status
  checkAuthStatus();

  // Render calendar
  renderCalendar();

  // Update week display
  updateWeekDisplay();

  // Listen for storage changes (when user updates AH duration in clock settings)
  window.addEventListener('storage', (e) => {
    if (e.key === 'personalizedAhDurationMinutes') {
      state.normalAphDayDurationMinutes = parseInt(e.newValue, 10);
      updateScaleFactor();
      renderCalendar();
    }
  });
}

// Update scale factor based on AH duration
function updateScaleFactor() {
  const normalHours = state.normalAphDayDurationMinutes / 60;
  if (normalHours === 0) {
    state.scaleFactor = 1;
  } else {
    state.scaleFactor = 24 / normalHours;
  }
}

// Set up event listeners
function setupEventListeners() {
  // Week navigation
  elements.prevWeekBtn.addEventListener('click', () => navigateWeek(-1));
  elements.nextWeekBtn.addEventListener('click', () => navigateWeek(1));

  // Time mode toggle
  elements.timeModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.timeMode = e.target.value;
      renderCalendar();
    });
  });

  // Calendar sync button
  elements.syncCalendarBtn.addEventListener('click', () => {
    if (state.isAuthenticated) {
      // If authenticated, show calendar selection
      window.location.href = '/pages/calendar-sync.html';
    } else {
      // Start OAuth flow
      initiateGoogleAuth();
    }
  });
}

// Navigate weeks
function navigateWeek(direction) {
  state.currentWeekStart.add(direction, 'week');
  updateWeekDisplay();
  renderCalendar();
  loadEvents();
}

// Update week display
function updateWeekDisplay() {
  const weekStart = state.currentWeekStart.format('MMM D');
  const weekEnd = state.currentWeekStart.clone().endOf('week').format('MMM D, YYYY');
  elements.currentWeekDisplay.textContent = `Week of ${weekStart} - ${weekEnd}`;
}

// Get time slots for display based on mode and AH settings
function getTimeSlots() {
  const slots = [];

  if (state.timeMode === 'real') {
    // Real time: simple 24 hours
    for (let hour = 0; hour < 24; hour++) {
      slots.push({
        label: `${hour.toString().padStart(2, '0')}:00`,
        realHour: hour,
        isAH: false
      });
    }
  } else {
    // AH or Both mode: need to calculate based on AH settings
    const normalDurationHours = state.normalAphDayDurationMinutes / 60;
    const ahDurationHours = 24 - normalDurationHours;

    // Scaled 24 hours (0-23)
    for (let ahHour = 0; ahHour < 24; ahHour++) {
      const realHour = ahHour / state.scaleFactor;
      if (realHour < normalDurationHours) {
        const label = state.timeMode === 'both' 
          ? `AH ${ahHour}:00\n(${formatRealTime(realHour)})`
          : `AH ${ahHour}:00`;

        slots.push({
          label: label,
          realHour: realHour,
          ahHour: ahHour,
          isAH: false,
          isScaled: true
        });
      }
    }

    // Another Hour period (24+)
    if (ahDurationHours > 0) {
      // Add AH 24 marker
      slots.push({
        label: state.timeMode === 'both' 
          ? `AH 24:00\n(${formatRealTime(normalDurationHours)})`
          : `AH 24:00`,
        realHour: normalDurationHours,
        ahHour: 24,
        isAH: true,
        isAHStart: true
      });

      // Add remaining AH hours
      for (let i = 1; i < Math.floor(ahDurationHours); i++) {
        const realHour = normalDurationHours + i;
        const ahHour = 24 + i;
        const label = state.timeMode === 'both' 
          ? `AH ${ahHour}:00\n(${formatRealTime(realHour)})`
          : `AH ${ahHour}:00`;

        slots.push({
          label: label,
          realHour: realHour,
          ahHour: ahHour,
          isAH: true
        });
      }
    }
  }

  return slots;
}

// Format real time from decimal hours
function formatRealTime(decimalHours) {
  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// Render calendar grid
function renderCalendar() {
  elements.calendarGrid.innerHTML = '';

  // Get time slots based on current mode
  const timeSlots = getTimeSlots();

  // Update grid template to accommodate variable height
  const rowCount = timeSlots.length + 1; // +1 for header
  elements.calendarGrid.style.gridTemplateRows = `auto repeat(${timeSlots.length}, minmax(40px, 1fr))`;

  // Add header row
  const headerRow = document.createElement('div');
  headerRow.className = 'calendar-header';
  headerRow.textContent = 'Time';
  elements.calendarGrid.appendChild(headerRow);

  // Add day headers
  for (let i = 0; i < 7; i++) {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'calendar-header';
    const dayDate = state.currentWeekStart.clone().add(i, 'days');
    dayHeader.innerHTML = `${DAYS_OF_WEEK[i]}<br>${dayDate.format('M/D')}`;
    elements.calendarGrid.appendChild(dayHeader);
  }

  // Add time slots and event cells
  timeSlots.forEach((slot, slotIndex) => {
    // Time slot
    const timeSlot = document.createElement('div');
    timeSlot.className = 'time-slot';
    if (slot.isAH) {
      timeSlot.classList.add('ah-period');
    }
    if (slot.isAHStart) {
      timeSlot.classList.add('ah-start');
    }

    // Handle multi-line labels for "both" mode
    if (slot.label.includes('\n')) {
      const lines = slot.label.split('\n');
      timeSlot.innerHTML = `${lines[0]}<br><small>${lines[1]}</small>`;
    } else {
      timeSlot.textContent = slot.label;
    }

    elements.calendarGrid.appendChild(timeSlot);

    // Event cells for each day
    for (let day = 0; day < 7; day++) {
      const eventCell = document.createElement('div');
      eventCell.className = 'event-cell';
      if (slot.isAH) {
        eventCell.classList.add('ah-period');
      }
      eventCell.dataset.realHour = slot.realHour;
      eventCell.dataset.day = day;
      if (slot.ahHour !== undefined) {
        eventCell.dataset.ahHour = slot.ahHour;
      }

      // Add events for this time slot
      const cellEvents = getEventsForCell(day, slot.realHour);
      cellEvents.forEach(event => {
        const eventEl = createEventElement(event);
        eventCell.appendChild(eventEl);
      });

      elements.calendarGrid.appendChild(eventCell);
    }
  });
}

// Get events for a specific cell
function getEventsForCell(day, realHour) {
  const cellDate = state.currentWeekStart.clone().add(day, 'days');
  const cellStart = cellDate.clone().add(realHour, 'hours');
  const cellEnd = cellStart.clone().add(1, 'hours');

  return state.events.filter(event => {
    const eventStart = moment(event.start);
    const eventEnd = moment(event.end);

    // Check if event overlaps with this cell
    return eventStart.isBefore(cellEnd) && eventEnd.isAfter(cellStart);
  });
}

// Create event element
function createEventElement(event) {
  const eventEl = document.createElement('div');
  eventEl.className = 'calendar-event';

  // Add time prefix if in AH mode
  if (state.timeMode === 'ah' || state.timeMode === 'both') {
    const eventStart = moment(event.start);
    const startHour = eventStart.hour() + eventStart.minute() / 60;
    const ahTime = convertRealToAH(startHour);
    eventEl.classList.add('ah-time');
    eventEl.innerHTML = `<small>AH ${Math.floor(ahTime)}:${Math.round((ahTime % 1) * 60).toString().padStart(2, '0')}</small><br>${event.title}`;
  } else {
    eventEl.textContent = event.title;
  }

  // Add click handler
  eventEl.addEventListener('click', () => showEventDetails(event));

  return eventEl;
}

// Convert real hours to AH hours
function convertRealToAH(realHours) {
  const normalDurationHours = state.normalAphDayDurationMinutes / 60;

  if (realHours < normalDurationHours) {
    // In scaled period
    return realHours * state.scaleFactor;
  } else {
    // In AH period
    return 24 + (realHours - normalDurationHours);
  }
}

// Convert AH hours to real hours
function convertAHToReal(ahHours) {
  if (ahHours < 24) {
    // In scaled period
    return ahHours / state.scaleFactor;
  } else {
    // In AH period
    const normalDurationHours = state.normalAphDayDurationMinutes / 60;
    return normalDurationHours + (ahHours - 24);
  }
}

// Show event details
function showEventDetails(event) {
  elements.eventDetails.style.display = 'block';

  const startTime = moment(event.start);
  const endTime = moment(event.end);

  // Calculate AH times
  const startHour = startTime.hour() + startTime.minute() / 60;
  const endHour = endTime.hour() + endTime.minute() / 60;
  const ahStartTime = convertRealToAH(startHour);
  const ahEndTime = convertRealToAH(endHour);

  elements.eventInfo.innerHTML = `
    <div class="event-info-row">
      <span class="event-info-label">Title:</span>
      <span>${event.title}</span>
    </div>
    <div class="event-info-row">
      <span class="event-info-label">Real Time:</span>
      <span>${startTime.format('MMM D, h:mm A')} - ${endTime.format('h:mm A')}</span>
    </div>
    <div class="event-info-row">
      <span class="event-info-label">AH Time:</span>
      <span>AH ${Math.floor(ahStartTime)}:${Math.round((ahStartTime % 1) * 60).toString().padStart(2, '0')} - AH ${Math.floor(ahEndTime)}:${Math.round((ahEndTime % 1) * 60).toString().padStart(2, '0')}</span>
    </div>
    ${event.description ? `
    <div class="event-info-row">
      <span class="event-info-label">Description:</span>
      <span>${event.description}</span>
    </div>
    ` : ''}
    ${event.location ? `
    <div class="event-info-row">
      <span class="event-info-label">Location:</span>
      <span>${event.location}</span>
    </div>
    ` : ''}
  `;
}

// Check authentication status
async function checkAuthStatus() {
  try {
    const response = await fetch('/api/calendar/google/status');
    const data = await response.json();

    state.isAuthenticated = data.authenticated;
    updateSyncStatus();

    if (state.isAuthenticated) {
      loadEvents();
    }
  } catch (error) {
    console.error('Error checking auth status:', error);
    state.isAuthenticated = false;
    updateSyncStatus();
  }
}

// Update sync status display
function updateSyncStatus() {
  if (state.isAuthenticated) {
    elements.syncStatus.innerHTML = `
      <p class="sync-connected">
        <span class="status-icon">✅</span>
        Google Calendar connected
      </p>
      <button id="sync-calendar-btn" class="primary-button">
        Manage Calendars
      </button>
    `;
  } else {
    elements.syncStatus.innerHTML = `
      <p class="sync-not-connected">
        <span class="status-icon">⚠️</span>
        No calendars connected
      </p>
      <button id="sync-calendar-btn" class="primary-button">
        Connect Google Calendar
      </button>
    `;
  }

  // Re-attach event listener
  document.getElementById('sync-calendar-btn').addEventListener('click', () => {
    if (state.isAuthenticated) {
      window.location.href = '/pages/calendar-sync.html';
    } else {
      initiateGoogleAuth();
    }
  });
}

// Initiate Google authentication
async function initiateGoogleAuth() {
  try {
    const response = await fetch('/api/calendar/google/auth-url');
    const data = await response.json();

    if (data.authUrl) {
      // Open auth URL in new window
      const authWindow = window.open(data.authUrl, 'GoogleAuth', 'width=500,height=600');

      // Listen for auth completion
      window.addEventListener('message', (event) => {
        if (event.data.type === 'google-auth-success') {
          authWindow.close();
          state.isAuthenticated = true;
          updateSyncStatus();
          loadEvents();
        }
      });
    }
  } catch (error) {
    console.error('Error initiating auth:', error);
    alert('Failed to start authentication. Please try again.');
  }
}

// Load events from calendar
async function loadEvents() {
  if (!state.isAuthenticated) return;

  try {
    const weekStart = state.currentWeekStart.toISOString();
    const weekEnd = state.currentWeekStart.clone().endOf('week').toISOString();

    const response = await fetch('/api/calendar/google/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeMin: weekStart,
        timeMax: weekEnd
      })
    });

    const data = await response.json();

    if (data.success) {
      state.events = data.events;
      renderCalendar();
    }
  } catch (error) {
    console.error('Error loading events:', error);
  }
}

// Initialize the application
initialize();