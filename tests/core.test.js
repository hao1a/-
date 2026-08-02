const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDatabase } = require('../lib/database');
const { createServices, AppError } = require('../lib/services');
const { buildTemplateWorkbook, readImportRows, buildExportWorkbook } = require('../lib/excel');

function makeContext() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-manager-test-'));
  const ctx = createDatabase(dataDir);
  const services = createServices(ctx);
  const admin = services.auth.currentUser(1);
  return { ctx, services, admin, dataDir };
}

test('数据库初始化会创建默认管理员和默认学籍状态', () => {
  const { ctx, services } = makeContext();
  const users = services.users.list();
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'admin');
  const statuses = services.settings.listStatuses();
  assert.ok(statuses.find((s) => s.label === '在读' && s.counts_to_total));
  ctx.close();
});

test('旧版数据库启动时自动补齐 is_archived 列', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-manager-old-'));
  const dbPath = path.join(dataDir, 'student-manager.db');
  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(`
    CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      student_no TEXT NOT NULL UNIQUE,
      id_card TEXT NOT NULL UNIQUE,
      class_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      enrollment_status TEXT,
      political_status TEXT,
      gender TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  oldDb.close();
  const ctx = createDatabase(dataDir);
  const columns = ctx.db.prepare('PRAGMA table_info(students)').all().map((row) => row.name);
  assert.ok(columns.includes('is_archived'));
  ctx.close();
});

test('登录校验密码，并记录登录日志', () => {
  const { ctx, services, admin } = makeContext();
  assert.throws(() => services.auth.login('admin', 'wrong'), AppError);
  const user = services.auth.login('admin', '123456');
  assert.equal(user.username, 'admin');
  const logs = services.logs.list({});
  assert.ok(logs.items.some((log) => log.action === '登录'));
  ctx.close();
});

test('学生必填校验与唯一学号校验', () => {
  const { ctx, services, admin } = makeContext();
  assert.throws(() => services.students.create(admin, { name: '张三' }), AppError);
  const id = services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  assert.ok(id > 0);
  assert.throws(() => services.students.create(admin, {
    name: '李四',
    student_no: '2025001',
    id_card: '110101200001015555',
    class_name: '2025级1班',
    phone: '13800000001'
  }), /学号/);
  ctx.close();
});

test('关键字搜索支持姓名、学号、身份证、政治面貌', () => {
  const { ctx, services, admin } = makeContext();
  services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000',
    political_status: '共青团员'
  });
  services.students.create(admin, {
    name: '李四',
    student_no: '2025002',
    id_card: '110101200001015555',
    class_name: '2025级2班',
    phone: '13800000001',
    political_status: '群众'
  });
  assert.equal(services.students.list({ keyword: '2025001', keywordType: 'student_no' }).total, 1);
  assert.equal(services.students.list({ keyword: '李四', keywordType: 'name' }).total, 1);
  assert.equal(services.students.list({ keyword: '5555', keywordType: 'id_card' }).total, 1);
  assert.equal(services.students.list({ keyword: '共青团员', keywordType: 'political_status' }).total, 1);
  ctx.close();
});

test('按班级和学籍状态组合筛选生效', () => {
  const { ctx, services, admin } = makeContext();
  const base = { phone: '13800000000' };
  services.students.create(admin, { ...base, name: '张三', student_no: '2025001', id_card: '110101200001011234', class_name: '2025级1班', enrollment_status: '在读' });
  services.students.create(admin, { ...base, name: '李四', student_no: '2025002', id_card: '110101200001015555', class_name: '2025级1班', enrollment_status: '休学' });
  services.students.create(admin, { ...base, name: '王五', student_no: '2025003', id_card: '110101200001017777', class_name: '2025级2班', enrollment_status: '在读' });
  assert.equal(services.students.list({ className: '2025级1班', enrollmentStatus: '在读' }).total, 1);
  assert.equal(services.students.list({ class_name: '2025级1班', enrollment_status: '在读' }).total, 1);
  assert.equal(services.students.list({ className: '2025级1班' }).total, 2);
  assert.equal(services.students.list({ enrollmentStatus: '在读' }).total, 2);
  ctx.close();
});

test('Excel 导入跳过重复学号与身份证并返回报告', () => {
  const { ctx, services, admin } = makeContext();
  services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  const rows = [
    { name: '王五', student_no: '2025002', id_card: '110101200001017777', class_name: '2025级1班', phone: '13800000002' },
    { name: '重复学号', student_no: '2025001', id_card: '110101200001018888', class_name: '2025级1班', phone: '13800000003' },
    { name: '缺必填', student_no: '', id_card: '', class_name: '', phone: '' }
  ];
  const report = services.students.importRows(admin, rows);
  assert.equal(report.imported.length, 1);
  assert.equal(report.skipped.length, 2);
  assert.equal(services.students.list({}).total, 2);
  ctx.close();
});

test('考勤折算：旷课学时 + (迟到+早退)÷3 向下取整', () => {
  const { ctx, services, admin } = makeContext();
  const studentId = services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  services.attendance.create(admin, { student_id: studentId, semester: '2025-2026-1', week_no: 1, start_period: 3, end_period: 4, attendance_type: '旷课' });
  services.attendance.create(admin, { student_id: studentId, semester: '2025-2026-1', week_no: 1, start_period: 1, end_period: 1, attendance_type: '迟到' });
  services.attendance.create(admin, { student_id: studentId, semester: '2025-2026-1', week_no: 1, start_period: 2, end_period: 2, attendance_type: '迟到' });
  services.attendance.create(admin, { student_id: studentId, semester: '2025-2026-1', week_no: 1, start_period: 5, end_period: 5, attendance_type: '早退' });
  const stats = services.attendance.stats(studentId, '2025-2026-1');
  assert.equal(stats.absent_periods, 2);
  assert.equal(stats.late_count, 2);
  assert.equal(stats.early_count, 1);
  assert.equal(stats.equivalent_absent, 3);
  ctx.close();
});

test('看板总人数只统计计入总人数的学籍状态', () => {
  const { ctx, services, admin } = makeContext();
  const base = { class_name: '2025级1班', phone: '13800000000' };
  services.students.create(admin, { ...base, name: '在读生', student_no: '2025001', id_card: '110101200001011234', enrollment_status: '在读' });
  services.students.create(admin, { ...base, name: '毕业生', student_no: '2025002', id_card: '110101200001015555', enrollment_status: '毕业' });
  const stats = services.dashboard.stats();
  assert.equal(stats.total_counted, 1);
  assert.equal(stats.total_all, 2);
  assert.equal(stats.enrollment_counts.find((s) => s.label === '毕业').value, 1);
  ctx.close();
});

test('归档学生后不再展示和统计，恢复后重新可见', () => {
  const { ctx, services, admin } = makeContext();
  const base = { class_name: '2025级1班', phone: '13800000000' };
  const id1 = services.students.create(admin, { ...base, name: '学生A', student_no: '2025001', id_card: '110101200001011234', enrollment_status: '在读' });
  const id2 = services.students.create(admin, { ...base, name: '学生B', student_no: '2025002', id_card: '110101200001015555', enrollment_status: '在读' });
  services.students.archive(admin, [id2], true);
  assert.equal(services.students.list({}).total, 1);
  assert.equal(services.students.list({ archived: '1' }).total, 1);
  const stats = services.dashboard.stats();
  assert.equal(stats.total_all, 1);
  assert.equal(stats.class_board[0].value, 1);
  services.students.archive(admin, [id2], false);
  assert.equal(services.students.list({}).total, 2);
  assert.equal(services.dashboard.stats().total_all, 2);
  assert.ok(id1 > 0);
  ctx.close();
});

test('成绩、综测、处分、奖励 CRUD 会写入操作日志', () => {
  const { ctx, services, admin } = makeContext();
  const studentId = services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  services.grades.create(admin, { student_id: studentId, semester: '2025-2026-1', course_name: '高等数学', score: 92 });
  services.evaluations.create(admin, { student_id: studentId, academic_year: '2025-2026', add_points: 5, deduct_points: 1, total_score: 84 });
  services.discipline.create(admin, { student_id: studentId, reason: '旷课', punishment_type: '警告', punishment_date: '2026-01-01', status: '处分中' });
  services.rewards.create(admin, { student_id: studentId, activity: '运动会', award_name: '一等奖', award_date: '2026-05-01' });
  const logs = services.logs.list({});
  const actions = logs.items.map((log) => log.action);
  assert.ok(actions.includes('新增成绩'));
  assert.ok(actions.includes('新增综测'));
  assert.ok(actions.includes('新增处分'));
  assert.ok(actions.includes('新增奖励'));
  assert.equal(services.grades.listByStudent(studentId).length, 1);
  assert.equal(services.evaluations.listByStudent(studentId).length, 1);
  assert.equal(services.discipline.list({ student_id: studentId }).length, 1);
  assert.equal(services.rewards.list({ student_id: studentId }).length, 1);
  ctx.close();
});

test('成绩汇总按学号导入，重复学期和未知学号会跳过', () => {
  const { ctx, services, admin } = makeContext();
  const studentId = services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  const report = services.gradeSummaries.importRows(admin, [
    { student_no: '2025001', semester: '2025-2026-1', rank: 2, course_count: 10, failed_course_count: 0, credits_taken: 18, credits_earned: 18, gpa: 3.7, credit_gpa: 66.6, avg_gpa: 3.7, avg_score: 88 },
    { student_no: '2025001', semester: '2025-2026-1', rank: 3 },
    { student_no: '9999999', name: '不存在', semester: '2025-2026-1' }
  ], '2025-2026-1');
  assert.equal(report.imported.length, 1);
  assert.equal(report.skipped.length, 2);
  assert.equal(services.gradeSummaries.list({}).length, 1);
  assert.equal(services.students.getDetail(studentId).grade_summaries.length, 1);
  ctx.close();
});

test('综测按学号批量导入', () => {
  const { ctx, services, admin } = makeContext();
  services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  const report = services.evaluations.importRows(admin, [
    { student_no: '2025001', academic_year: '2025-2026', add_points: 5, deduct_points: 1, total_score: 84, notes: '优秀' },
    { student_no: '2025001', academic_year: '2025-2026', add_points: 2, deduct_points: 0, total_score: 90 }
  ], '2025-2026');
  assert.equal(report.imported.length, 1);
  assert.equal(report.skipped.length, 1);
  const records = services.evaluations.listAll({});
  assert.equal(records.length, 1);
  assert.equal(records[0].total_score, 84);
  ctx.close();
});

test('考勤按学号导入并生成个人累计统计', () => {
  const { ctx, services, admin } = makeContext();
  const studentId = services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  const report = services.attendance.importRows(admin, [
    { student_no: '2025001', semester: '2025-2026-1', week_no: 1, start_period: 1, end_period: 2, attendance_type: '旷课' },
    { student_no: '2025001', semester: '2025-2026-1', week_no: 1, start_period: 3, end_period: 3, attendance_type: '迟到' },
    { student_no: '2025001', semester: '2025-2026-1', week_no: 2, start_period: 1, end_period: 1, attendance_type: '早退' },
    { student_no: '2025001', semester: '2025-2026-1', week_no: 1, start_period: 1, end_period: 2, attendance_type: '旷课' }
  ], '2025-2026-1');
  assert.equal(report.imported.length, 3);
  assert.equal(report.skipped.length, 1);
  const cumulative = services.attendance.cumulativeStats();
  assert.equal(cumulative.length, 1);
  assert.equal(cumulative[0].absent_periods, 2);
  assert.equal(cumulative[0].late_count, 1);
  assert.equal(cumulative[0].early_count, 1);
  assert.equal(cumulative[0].equivalent_absent, 2);
  assert.equal(services.attendance.stats(studentId, '2025-2026-1').equivalent_absent, 2);
  ctx.close();
});

test('考勤累计支持按学期筛选，支持批量删除', () => {
  const { ctx, services, admin } = makeContext();
  const studentId = services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  const id1 = services.attendance.create(admin, { student_id: studentId, semester: '2025-2026-1', week_no: 1, start_period: 1, end_period: 1, attendance_type: '旷课' });
  const id2 = services.attendance.create(admin, { student_id: studentId, semester: '2025-2026-2', week_no: 1, start_period: 2, end_period: 2, attendance_type: '迟到' });
  const firstSemester = services.attendance.cumulativeStats('2025-2026-1');
  assert.equal(firstSemester.length, 1);
  assert.equal(firstSemester[0].absent_periods, 1);
  assert.equal(firstSemester[0].late_count, 0);
  services.attendance.batchRemove(admin, [id1, id2]);
  assert.equal(services.attendance.list({}).length, 0);
  ctx.close();
});

test('奖励记录支持颁发单位', () => {
  const { ctx, services, admin } = makeContext();
  const studentId = services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  const id = services.rewards.create(admin, {
    student_id: studentId,
    award_name: '一等奖',
    issuer: '校团委',
    award_date: '2026年5月'
  });
  const record = services.rewards.list({ student_id: studentId })[0];
  assert.equal(record.issuer, '校团委');
  assert.equal(record.award_date, '2026年5月');
  services.rewards.update(admin, { ...record, issuer: '学生处' });
  assert.equal(services.rewards.list({ student_id: studentId })[0].issuer, '学生处');
  ctx.close();
});

test('处分与奖励支持按学号批量导入并跳过重复', () => {
  const { ctx, services, admin } = makeContext();
  services.students.create(admin, {
    name: '张三',
    student_no: '2025001',
    id_card: '110101200001011234',
    class_name: '2025级1班',
    phone: '13800000000'
  });
  const disciplineReport = services.discipline.importRows(admin, [
    { student_no: '2025001', punishment_type: '警告', reason: '旷课', punishment_date: '2026-01-01', status: '处分中' },
    { student_no: '2025001', punishment_type: '警告', reason: '旷课', punishment_date: '2026-01-01', status: '处分中' }
  ]);
  assert.equal(disciplineReport.imported.length, 1);
  assert.equal(disciplineReport.skipped.length, 1);
  const rewardReport = services.rewards.importRows(admin, [
    { student_no: '2025001', award_name: '一等奖', issuer: '校团委', award_date: '2026年5月' },
    { student_no: '9999999', award_name: '二等奖', award_date: '2026年6月' }
  ]);
  assert.equal(rewardReport.imported.length, 1);
  assert.equal(rewardReport.skipped.length, 1);
  assert.equal(services.discipline.list({}).length, 1);
  assert.equal(services.rewards.list({}).length, 1);
  ctx.close();
});

test('Excel 模板和导出工作簿可读写', () => {
  const workbook = buildTemplateWorkbook();
  assert.ok(workbook.SheetNames.includes('学生信息'));
  const students = [{ name: '张三', student_no: '2025001', id_card: '110101200001011234', class_name: '2025级1班', phone: '13800000000' }];
  const exportWorkbook = buildExportWorkbook(students);
  assert.ok(exportWorkbook.Sheets['学生信息']);
  assert.ok(workbook);
  assert.ok(exportWorkbook);
});
