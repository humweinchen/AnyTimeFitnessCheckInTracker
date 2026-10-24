/**
 * AF Check-in League & Attendance Tracker
 * Module: checkin_logic.js
 * 
 * Standalone logic engine providing:
 * 1. Retroactive Re-Tap Engine (Handling forgotten gym visits)
 * 2. Anytime Fitness 1-Day Policy Consolidation (Multiple fob scans on 1 calendar day = 1 workout visit)
 * 3. 50% Home Club Retention Threshold Calculator
 * 4. Client-side PDF Statement Parsing Regex Utilities
 * 5. AF Native App & Member Portal Deep-Link Bridge
 */

// ============================================================================
// 1. RETROACTIVE RE-TAP ENGINE
// ============================================================================

/**
 * Creates and logs a retroactive check-in record for a past missed date.
 * 
 * @param {Array<Object>} existingVisits - Current array of visit records.
 * @param {string} branch - The Anytime Fitness club name.
 * @param {string} dateString - Date in format 'YYYY-MM-DD' (e.g., '2026-10-18').
 * @param {string} timeSlot - Desired time slot ('Late Night', 'Early Morning', 'Daytime', 'Evening').
 * @param {string} [customTime] - Optional specific time (e.g., '07:30 AM'). If omitted, defaults to typical slot hour.
 * @param {string} [notes] - Optional workout session notes.
 * @returns {{ updatedVisits: Array<Object>, newEntry: Object }}
 */
export function retroactiveReTap(existingVisits, branch, dateString, timeSlot = 'Daytime', customTime = null, notes = '') {
  if (!branch || !dateString) {
    throw new Error('Branch club name and date are required for retroactive logging.');
  }

  // Parse YYYY-MM-DD safely
  const parts = dateString.split('-');
  const yyyy = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10) - 1;
  const dd = parseInt(parts[2], 10);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Slot default times if customTime is not supplied
  const slotDefaults = {
    'Late Night': { hour: 1, min: 15, str: '1:15 AM' },
    'Early Morning': { hour: 6, min: 30, str: '6:30 AM' },
    'Daytime': { hour: 11, min: 45, str: '11:45 AM' },
    'Evening': { hour: 19, min: 30, str: '7:30 PM' }
  };

  const slotData = slotDefaults[timeSlot] || slotDefaults['Daytime'];
  const formattedTime = customTime || slotData.str;
  const hour24 = slotData.hour;

  const dateObj = new Date(yyyy, mm, dd, hour24, slotData.min);
  const dateFormatted = `${monthNames[mm]} ${dd}, ${yyyy}`;
  const weekday = weekdayNames[dateObj.getDay()];
  const timestamp = `${yyyy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')} ${String(hour24).padStart(2, '0')}:${String(slotData.min).padStart(2, '0')}`;

  const nextId = existingVisits.length > 0 ? Math.max(...existingVisits.map(v => v.id || 0)) + 1 : 1;

  const newEntry = {
    id: nextId,
    branch: branch.trim(),
    date: dateFormatted,
    time: formattedTime,
    timestamp: timestamp,
    day: dd,
    weekday: weekday,
    hour: hour24,
    timeSlot: timeSlot,
    isManualEntry: true,
    notes: notes.trim()
  };

  // Prepend and sort chronologically descending
  const updatedVisits = [newEntry, ...existingVisits].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return { updatedVisits, newEntry };
}

// ============================================================================
// 2. ANYTIME FITNESS 1-DAY POLICY ENGINE
// ============================================================================

/**
 * Computes consolidated attendance stats under official Anytime Fitness club regulations.
 * Rule: Multiple door entries / fob scans on the same calendar day count as ONE workout visit.
 * 
 * @param {Array<Object>} visits - All raw check-in records.
 * @param {string} homeClubName - The registered home club.
 * @returns {Object} Consolidated statistics.
 */
export function computeAFDailyPolicy(visits, homeClubName) {
  const dayMap = {};

  visits.forEach(v => {
    const d = v.day || (new Date(v.timestamp).getDate());
    if (!dayMap[d]) dayMap[d] = [];
    dayMap[d].push(v);
  });

  const uniqueActiveDays = Object.keys(dayMap).map(Number).sort((a, b) => b - a);
  const totalActiveWorkoutDays = uniqueActiveDays.length;
  const totalRawDoorTaps = visits.length;

  const clubDayAttendance = {};
  const clubTapAttendance = {};
  const latestVisitMap = {};

  uniqueActiveDays.forEach(day => {
    const dayTaps = dayMap[day];
    const clubsVisitedToday = new Set();

    dayTaps.forEach(tap => {
      clubTapAttendance[tap.branch] = (clubTapAttendance[tap.branch] || 0) + 1;
      clubsVisitedToday.add(tap.branch);

      if (!latestVisitMap[tap.branch]) {
        latestVisitMap[tap.branch] = { date: tap.date, time: tap.time };
      }
    });

    // Award 1 workout day visit to each branch visited on this calendar day
    clubsVisitedToday.forEach(club => {
      clubDayAttendance[club] = (clubDayAttendance[club] || 0) + 1;
    });
  });

  // Calculate Home Club percentage under AF 1-Day Policy
  const homeWorkoutDays = clubDayAttendance[homeClubName] || 0;
  const homePolicyPercentage = totalActiveWorkoutDays > 0 
    ? parseFloat(((homeWorkoutDays / totalActiveWorkoutDays) * 100).toFixed(1))
    : 0.0;

  // Calculate Home Club percentage under raw fob taps
  const homeRawTaps = clubTapAttendance[homeClubName] || 0;
  const homeTapsPercentage = totalRawDoorTaps > 0
    ? parseFloat(((homeRawTaps / totalRawDoorTaps) * 100).toFixed(1))
    : 0.0;

  const isHomeClubSecure = homePolicyPercentage >= 50.0;

  return {
    totalActiveWorkoutDays,
    totalRawDoorTaps,
    dayMap,
    clubDayAttendance,
    clubTapAttendance,
    latestVisitMap,
    homeWorkoutDays,
    homePolicyPercentage,
    homeRawTaps,
    homeTapsPercentage,
    isHomeClubSecure
  };
}

// ============================================================================
// 3. ANYTIME FITNESS PDF STATEMENT PARSING UTILITIES
// ============================================================================

/**
 * Parses raw text extracted from an Anytime Fitness PDF statement into structured records.
 * 
 * @param {Array<string>} textPages - Array of text lines/blocks extracted via pdf.js.
 * @returns {{ memberName: string|null, parsedVisits: Array<Object> }}
 */
export function parseAFStatementText(textPages) {
  let detectedMemberName = null;
  const extractedRecords = [];
  let recordId = 1;

  const dateRegex = /(?:([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})|(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})|(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}))/i;
  const timeRegex = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i;

  textPages.forEach(pageText => {
    // Detect member name from statement header
    if (!detectedMemberName) {
      const nameMatch = pageText.match(/Member\s*(?:Name)?\s*[:\-]?\s*([A-Za-z\s]{3,35})/i);
      if (nameMatch && nameMatch[1].trim().length > 2) {
        detectedMemberName = nameMatch[1].trim();
      }
    }

    const lines = pageText.split(/(?<=[AP]M|\d{4})\s+/);

    lines.forEach(line => {
      const dMatch = line.match(dateRegex);
      const tMatch = line.match(timeRegex);

      if (dMatch && tMatch) {
        const rawDate = dMatch[0];
        const rawTime = tMatch[0];

        let club = line
          .replace(rawDate, '')
          .replace(rawTime, '')
          .replace(/check-?in|door|access|entry|fob|granted|tap|success/gi, '')
          .trim();

        if (!club || club.length < 3) club = 'Anytime Fitness Club';

        const parsedDate = new Date(rawDate);
        const validDate = !isNaN(parsedDate.getTime()) ? parsedDate : new Date();

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dateStr = `${monthNames[validDate.getMonth()]} ${validDate.getDate()}, ${validDate.getFullYear()}`;

        // Parse hour
        const timeParts = rawTime.replace(/[^\d:]/g, '').split(':');
        let h = parseInt(timeParts[0], 10);
        const m = timeParts.length > 1 ? parseInt(timeParts[1], 10) : 0;
        if (rawTime.toLowerCase().includes('pm') && h < 12) h += 12;
        if (rawTime.toLowerCase().includes('am') && h === 12) h = 0;

        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;

        let slot = 'Daytime';
        if (23 <= h || h < 5) slot = 'Late Night';
        else if (5 <= h && h < 9) slot = 'Early Morning';
        else if (9 <= h && h < 17) slot = 'Daytime';
        else slot = 'Evening';

        extractedRecords.push({
          id: recordId++,
          branch: club,
          date: dateStr,
          time: timeStr,
          timestamp: `${validDate.getFullYear()}-${String(validDate.getMonth() + 1).padStart(2, '0')}-${String(validDate.getDate()).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          day: validDate.getDate(),
          hour: h,
          timeSlot: slot
        });
      }
    });
  });

  return {
    memberName: detectedMemberName || 'Anytime Fitness Member',
    parsedVisits: extractedRecords
  };
}

// ============================================================================
// 4. AF APP & MEMBER PORTAL BRIDGE CONTROLLER
// ============================================================================

/**
 * Handles cross-application navigation to Anytime Fitness native apps and web portals.
 * 
 * Technical Reality:
 * - Direct silent scraping or background session extraction is blocked by iOS/Android App Sandboxing
 *   and Web Browser Cross-Origin Resource Sharing (CORS).
 * - Third-party developer APIs (ABC Fitness / Club Automation) are private enterprise-only.
 * - The bridge uses custom URL schemes (af://) with graceful fallback to the web portal.
 * 
 * @param {'app'|'portal'|'history'} target - Destination action.
 */
export function openAFBridge(target = 'app') {
  const AF_CUSTOM_SCHEME = 'af://';
  const AF_PORTAL_LOGIN_URL = 'https://www.anytimefitness.com/login/';
  const AF_MY_ACCOUNT_URL = 'https://www.anytimefitness.com/my-account/';

  if (target === 'portal') {
    window.open(AF_PORTAL_LOGIN_URL, '_blank', 'noopener,noreferrer');
    return;
  }

  if (target === 'history') {
    window.open(AF_MY_ACCOUNT_URL, '_blank', 'noopener,noreferrer');
    return;
  }

  // Target: 'app' - attempt custom scheme with fallback timeout
  const start = Date.now();
  window.location.href = AF_CUSTOM_SCHEME;

  setTimeout(() => {
    // If browser remains active after 1500ms, app is likely not installed or protocol handler unmapped
    if (Date.now() - start < 2000) {
      window.open(AF_PORTAL_LOGIN_URL, '_blank', 'noopener,noreferrer');
    }
  }, 1500);
}
