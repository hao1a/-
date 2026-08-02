const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_STATUSES = [
  { label: '在读', countsToTotal: 1, sortOrder: 1 },
  { label: '休学', countsToTotal: 0, sortOrder: 2 },
  { label: '退学', countsToTotal: 0, sortOrder: 3 },
  { label: '毕业', countsToTotal: 0, sortOrder: 4 },
  { label: '保留学籍', countsToTotal: 0, sortOrder: 5 },
  { label: '转学离校', countsToTotal: 0, sortOrder: 6 }
];

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function createDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const photosDir = path.join(dataDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });

  const dbPath = path.join(dataDir, 'student-manager.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  seedDefaults(db);

  return {
    db,
    dbPath,
    dataDir,
    photosDir,
    now: nowStr,
    hashPassword,
    verifyPassword,
    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      if (db && db.isOpen) db.close();
    }
  };
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS enrollment_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      counts_to_total INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_path TEXT,
      name TEXT NOT NULL,
      student_no TEXT NOT NULL UNIQUE,
      id_card TEXT NOT NULL UNIQUE,
      grade TEXT,
      school_years TEXT,
      major TEXT,
      class_name TEXT NOT NULL,
      political_status TEXT,
      gender TEXT,
      phone TEXT NOT NULL,
      community TEXT,
      dorm_room TEXT,
      bed_no TEXT,
      birth_date TEXT,
      ethnicity TEXT,
      household_address TEXT,
      current_address TEXT,
      father_name TEXT,
      father_phone TEXT,
      mother_name TEXT,
      mother_phone TEXT,
      emergency_name TEXT,
      emergency_phone TEXT,
      talents TEXT,
      poverty_status TEXT,
      hardship_level TEXT,
      scholarship_level TEXT,
      enrollment_status TEXT,
      counselor TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS semester_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      semester TEXT NOT NULL,
      course_name TEXT NOT NULL,
      score REAL,
      is_failed INTEGER NOT NULL DEFAULT 0,
      is_makeup INTEGER NOT NULL DEFAULT 0,
      is_retake INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(student_id, semester, course_name)
    );

    CREATE TABLE IF NOT EXISTS comprehensive_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_year TEXT NOT NULL,
      add_points REAL NOT NULL DEFAULT 0,
      deduct_points REAL NOT NULL DEFAULT 0,
      total_score REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(student_id, academic_year)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      semester TEXT NOT NULL,
      week_no INTEGER NOT NULL,
      start_period INTEGER NOT NULL,
      end_period INTEGER NOT NULL,
      attendance_type TEXT NOT NULL CHECK(attendance_type IN ('旷课','迟到','早退')),
      period_count INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      attendance_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS disciplinary_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      punishment_type TEXT NOT NULL,
      punishment_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '处分中',
      revoke_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reward_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      activity TEXT NOT NULL,
      award_name TEXT NOT NULL,
      issuer TEXT,
      award_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grade_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      semester TEXT NOT NULL,
      rank INTEGER,
      course_count INTEGER,
      failed_course_count INTEGER,
      credits_taken REAL,
      credits_earned REAL,
      gpa REAL,
      credit_gpa REAL,
      avg_gpa REAL,
      avg_score REAL,
      admin_class TEXT,
      class_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(student_id, semester)
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name);
    CREATE INDEX IF NOT EXISTS idx_students_status ON students(enrollment_status);
    CREATE INDEX IF NOT EXISTS idx_students_political ON students(political_status);
    CREATE INDEX IF NOT EXISTS idx_students_gender ON students(gender);
    CREATE INDEX IF NOT EXISTS idx_grades_student ON semester_grades(student_id);
    CREATE INDEX IF NOT EXISTS idx_evaluations_student ON comprehensive_evaluations(student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);
    CREATE INDEX IF NOT EXISTS idx_discipline_student ON disciplinary_records(student_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_student ON reward_records(student_id);
    CREATE INDEX IF NOT EXISTS idx_grade_summaries_student ON grade_summaries(student_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON operation_logs(created_at);
  `);
  ensureColumn(db, 'reward_records', 'issuer', 'TEXT');
  ensureColumn(db, 'students', 'is_archived', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'attendance_records', 'attendance_date', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_students_archived ON students(is_archived)');
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedDefaults(db) {
  const statusCount = db.prepare('SELECT COUNT(*) AS c FROM enrollment_statuses').get().c;
  if (statusCount === 0) {
    const insert = db.prepare(
      'INSERT INTO enrollment_statuses (label, counts_to_total, sort_order, created_at) VALUES (?, ?, ?, ?)'
    );
    DEFAULT_STATUSES.forEach((s) => insert.run(s.label, s.countsToTotal, s.sortOrder, nowStr()));
  }

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const { salt, hash } = hashPassword('123456');
    db.prepare(
      'INSERT INTO users (username, password_hash, password_salt, display_name, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).run('admin', hash, salt, '管理员', nowStr());
  }
}

module.exports = {
  createDatabase,
  hashPassword,
  verifyPassword,
  DEFAULT_STATUSES,
  nowStr
};
