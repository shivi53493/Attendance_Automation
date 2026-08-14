import * as fs from 'fs';
import { StudentProfile } from './types';

/**
 * Loads and parses the students CSV into a StudentProfile[].
 *
 * Expected header row: username,password,displayName,label
 * `label` is optional — if omitted, `username` is used as the log-prefix
 * label instead.
 *
 * Basic CSV rules supported: comma-separated, optional double-quoted
 * fields (so a value can contain a comma if wrapped in quotes), blank
 * lines and lines starting with `#` are skipped.
 */
export function loadStudents(csvPath: string): StudentProfile[] {
  if (!fs.existsSync(csvPath)) {
    throw new Error(
      `Students CSV not found at "${csvPath}". Create it (see students.example.csv) or set STUDENTS_CSV_PATH in .env.`
    );
  }

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) {
    throw new Error(`Students CSV at "${csvPath}" is empty.`);
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const usernameIdx = header.indexOf('username');
  const passwordIdx = header.indexOf('password');
  const displayNameIdx = header.indexOf('displayname');
  const labelIdx = header.indexOf('label');

  if (usernameIdx === -1 || passwordIdx === -1 || displayNameIdx === -1) {
    throw new Error(
      `Students CSV header must include username,password,displayName columns. Found: "${lines[0]}"`
    );
  }

  const students: StudentProfile[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);

    const username = (cells[usernameIdx] || '').trim();
    const password = (cells[passwordIdx] || '').trim();
    const displayName = (cells[displayNameIdx] || '').trim();
    const label = (labelIdx !== -1 ? cells[labelIdx] : '')?.trim() || username;

    if (!username || !password || !displayName) {
      throw new Error(
        `Students CSV row ${i + 1} is missing a required field (username/password/displayName): "${lines[i]}"`
      );
    }

    students.push({ username, password, displayName, label });
  }

  if (students.length === 0) {
    throw new Error(`Students CSV at "${csvPath}" has a header but no data rows.`);
  }

  return students;
}

/**
 * Parses a single CSV line into cells, honoring double-quoted fields
 * (so `"Doe, John"` is one field, not two). Good enough for credential
 * data; not a full RFC-4180 parser.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);

  return cells;
}