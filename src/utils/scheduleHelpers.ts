// Helper functions for Eastern timezone handling (EST/EDT)
export function getEasternDate(): Date {
  // Get current time in Eastern timezone
  const now = new Date();
  const easternTime = new Date(
    now.toLocaleString("en-US", {
      timeZone: "America/New_York",
    }),
  );
  return easternTime;
}

export function createEasternDate(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  // Create a date in Eastern timezone
  // Use ISO string format with Eastern timezone offset
  const isDST = isDaylightSavingTime(new Date(year, month - 1, day));
  const offset = isDST ? "-04:00" : "-05:00"; // EDT vs EST

  const isoString = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00.000${offset}`;
  return new Date(isoString);
}

export function isDaylightSavingTime(date: Date): boolean {
  // Simple DST check for Eastern timezone
  // DST typically runs from second Sunday in March to first Sunday in November
  const year = date.getFullYear();
  const march = new Date(year, 2, 1); // March 1st
  const november = new Date(year, 10, 1); // November 1st

  // Find second Sunday in March
  const dstStart = new Date(march);
  dstStart.setDate(1 + (7 - march.getDay()) + 7); // Second Sunday

  // Find first Sunday in November
  const dstEnd = new Date(november);
  dstEnd.setDate(1 + ((7 - november.getDay()) % 7)); // First Sunday

  return date >= dstStart && date < dstEnd;
}

// Main time parsing function
export function parseScheduleTime(input: string): Date | null {
  // Get current time in Eastern timezone
  const now = getEasternDate();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Remove extra whitespace and convert to lowercase
  const cleaned = input.trim().toLowerCase();

  // Support "now"
  if (cleaned === "now") {
    return now;
  }

  // Support relative times with "in" or "after"
  if (cleaned.startsWith("in ") || cleaned.startsWith("after ")) {
    const relString = cleaned.replace(/^(in |after )/, "");
    const relMs = parseScheduleRelativeTime(relString);
    if (relMs) {
      return new Date(now.getTime() + relMs);
    }
  }

  // Support pure relative format like "2h30m"
  const relativeRegex =
    /(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?)?)?)?/i;
  if (relativeRegex.test(cleaned)) {
    const relMs = parseScheduleRelativeTime(cleaned);
    if (relMs) {
      return new Date(now.getTime() + relMs);
    }
  }

  try {
    // Handle "tomorrow" prefix
    if (cleaned.startsWith("tomorrow")) {
      const timeString = cleaned.replace("tomorrow", "").trim();
      const timeOnly = parseScheduleTimeOnly(timeString);
      if (timeOnly) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return createEasternDate(
          tomorrow.getFullYear(),
          tomorrow.getMonth() + 1,
          tomorrow.getDate(),
          timeOnly.hours,
          timeOnly.minutes,
        );
      }
    }

    // Try to parse as full datetime (YYYY-MM-DD HH:mm or MM/DD/YYYY HH:mm)
    const fullDateFormats = [
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i,
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i,
    ];

    for (const format of fullDateFormats) {
      const match = cleaned.match(format);
      if (match) {
        let year: number,
          month: number,
          day: number,
          hours: number,
          minutes: number;

        if (format === fullDateFormats[0]) {
          // YYYY-MM-DD format
          const nums = match.map((x) => Number(x || 0));
          year = nums[1] || 0;
          month = nums[2] || 0;
          day = nums[3] || 0;
          hours = nums[4] || 0;
          minutes = nums[5] || 0;
        } else {
          // MM/DD/YYYY format
          const nums = match.map((x) => Number(x || 0));
          month = nums[1] || 0;
          day = nums[2] || 0;
          year = nums[3] || 0;
          hours = nums[4] || 0;
          minutes = nums[5] || 0;
        }

        const ampm = match[6];
        if (ampm) {
          if (ampm === "pm" && hours !== 12) hours += 12;
          if (ampm === "am" && hours === 12) hours = 0;
        }

        return createEasternDate(year, month, day, hours, minutes ?? 0);
      }
    }

    // Try to parse as time only for today
    const timeOnly = parseScheduleTimeOnly(cleaned);
    if (timeOnly) {
      let targetDate = createEasternDate(
        today.getFullYear(),
        today.getMonth() + 1,
        today.getDate(),
        timeOnly.hours,
        timeOnly.minutes,
      );

      // If the time has already passed today, schedule for tomorrow
      if (targetDate <= now) {
        targetDate = createEasternDate(
          today.getFullYear(),
          today.getMonth() + 1,
          today.getDate() + 1,
          timeOnly.hours,
          timeOnly.minutes,
        );
      }

      return targetDate;
    }

    // Try parsing as a natural language date
    const parsed = new Date(input);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch (error) {
    console.error("Time parsing error:", error);
  }

  return null;
}

export function parseScheduleTimeOnly(
  timeString: string,
): { hours: number; minutes: number } | null {
  let match: RegExpMatchArray | null;

  // HH:MM AM/PM
  match = timeString.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (match) {
    let hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const ampm = match[3]!.toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }

  // HH:MM 24h
  match = timeString.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    return { hours, minutes };
  }

  // H AM/PM
  match = timeString.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (match) {
    let hours = parseInt(match[1] || "0", 10);
    const minutes = 0;
    const ampm = match[2]!.toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }

  // H 24h
  match = timeString.match(/^(\d{1,2})$/);
  if (match) {
    const hours = parseInt(match[1] || "0", 10);
    const minutes = 0;
    return { hours, minutes };
  }

  return null;
}

export function parseScheduleRelativeTime(rel: string): number | null {
  const relativeRegex =
    /(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?)?)?)?/i;
  const match = rel.match(relativeRegex);
  if (!match) return null;

  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  const seconds = match[4] ? parseInt(match[4], 10) : 0;

  if (days === 0 && hours === 0 && minutes === 0 && seconds === 0) return null;

  return days * 86400000 + hours * 3600000 + minutes * 60000 + seconds * 1000;
}

export function parseScheduleInterval(input: string): number | null {
  const cleaned = input.trim().toLowerCase();
  const match = cleaned.match(
    /^(\d+)\s*(m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)$/,
  );

  if (!match) return null;

  const value = parseInt(match[1] || "0", 10);
  const unit = match[2];

  switch (unit) {
    case "m":
    case "min":
    case "minute":
    case "minutes":
      return value;
    case "h":
    case "hr":
    case "hour":
    case "hours":
      return value * 60;
    case "d":
    case "day":
    case "days":
      return value * 60 * 24;
    case "w":
    case "week":
    case "weeks":
      return value * 60 * 24 * 7;
    default:
      return null;
  }
}

export function formatScheduleInterval(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  } else if (minutes < 60 * 24) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  } else if (minutes < 60 * 24 * 7) {
    const days = minutes / (60 * 24);
    return `${days} day${days === 1 ? "" : "s"}`;
  } else {
    const weeks = minutes / (60 * 24 * 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
}
