import { Lecture } from './types';

/**
 * Parses a timing string like "09.30 AM-10.30 AM" into start and end Date objects for today.
 */
export function parseTimingToDate(timing: string): { startTime: Date; endTime: Date } {
  // Split on the hyphen between start and end times
  // Handle formats like "09.30 AM-10.30 AM" or "12.00 PM-01.00 PM"
  const parts = timing.split('-');
  if (parts.length !== 2) {
    throw new Error(`Invalid timing format: "${timing}". Expected format: "HH.MM AM/PM-HH.MM AM/PM"`);
  }

  const startStr = parts[0].trim();
  const endStr = parts[1].trim();

  const startTime = parseTimeString(startStr);
  const endTime = parseTimeString(endStr);

  return { startTime, endTime };
}

/**
 * Parses a single time string like "09.30 AM" into a Date object for today.
 */
function parseTimeString(timeStr: string): Date {
  // Match patterns like "09.30 AM", "12.00 PM", "01.00 PM"
  const match = timeStr.match(/^(\d{1,2})\.(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    throw new Error(`Invalid time format: "${timeStr}". Expected format: "HH.MM AM/PM"`);
  }

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  // Convert to 24-hour format
  if (period === 'AM' && hours === 12) {
    hours = 0;
  } else if (period === 'PM' && hours !== 12) {
    hours += 12;
  }

  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  return date;
}

/**
 * Returns the number of milliseconds until the target time.
 * Returns 0 if the target time has already passed.
 */
export function getDelayUntil(targetTime: Date): number {
  const now = new Date();
  const delay = targetTime.getTime() - now.getTime();
  return Math.max(0, delay);
}

/**
 * Checks if a lecture hasn't ended yet (i.e., its end time is in the future).
 */
export function isLectureUpcoming(lecture: Lecture): boolean {
  const now = new Date();
  return lecture.endTime.getTime() > now.getTime();
}

/**
 * Checks if a lecture is currently in progress.
 */
export function isLectureInProgress(lecture: Lecture): boolean {
  const now = new Date();
  return now.getTime() >= lecture.startTime.getTime() && now.getTime() < lecture.endTime.getTime();
}

/**
 * Formats a Date object into a human-readable time string.
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Returns milliseconds between two dates.
 */
export function getDurationMs(start: Date, end: Date): number {
  return end.getTime() - start.getTime();
}

/**
 * Formats milliseconds into a human-readable string like "1h 30m" or "45m 10s".
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);

  return parts.join(' ') || '0s';
}
