/**
 * Represents one student's credentials/identity, as loaded from the
 * students CSV. Each student runs the full login -> scrape -> attend
 * pipeline independently, in their own isolated browser context.
 */
export interface StudentProfile {
  /** LMS username/roll number used to log in */
  username: string;

  /** LMS password */
  password: string;

  /** Name shown in the Teams "Type your name" field on the pre-join screen */
  displayName: string;

  /** Short label used to prefix this student's log lines, e.g. "Shivam".
   *  Falls back to `username` if not provided in the CSV. */
  label: string;
}

/**
 * Represents a single lecture entry from the LMS schedule table.
 */
export interface Lecture {
  /** Full subject name, e.g. "Internet of Things-CSE 312" */
  subject: string;

  /** Subject code, e.g. "CSE 312" */
  code: string;

  /** Raw timing string from the table, e.g. "09.30 AM-10.30 AM" */
  timing: string;

  /** Parsed start time as a Date object for today */
  startTime: Date;

  /** Parsed end time as a Date object for today */
  endTime: Date;

  /** Microsoft Teams meeting join URL */
  link: string;
}