const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const { createDatabase } = require('./lib/database');
const { createServices, AppError } = require('./lib/services');
const excelLib = require('./lib/excel');

const APP_NAME = '学生管理系统';
const DEFAULT_DATA_DIR = path.join(app.getPath('appData'), 'StudentManager');
const dataDir = process.env.STUDENT_MANAGER_DATA_DIR || DEFAULT_DATA_DIR;

function writeStartupLog(message) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, 'startup.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // 日志写入失败不阻断启动
  }
}

function saveImportErrorReport(report) {
  if (!report || !report.skipped || !report.skipped.length) return null;
  try {
    const errorDir = path.join(dataDir, 'import-errors');
    fs.mkdirSync(errorDir, { recursive: true });
    const file = path.join(errorDir, `导入错误_${Date.now()}.xlsx`);
    excelLib.writeWorkbook(excelLib.buildImportErrorWorkbook(report), file);
    return file;
  } catch {
    return null;
  }
}

process.on('uncaughtException', (err) => {
  writeStartupLog(`UNCAUGHT ${err && err.stack || err}`);
});

process.on('unhandledRejection', (reason) => {
  writeStartupLog(`UNHANDLED ${reason && reason.stack || reason}`);
});

if (process.env.STUDENT_MANAGER_SMOKE) console.log('MAIN_START', dataDir);
writeStartupLog('MAIN_START');

let mainWindow = null;
let ctx = null;
let services = null;
const sessions = new Map();

app.setAppUserModelId('com.local.studentmanager');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);

function requireSession(token) {
  const session = sessions.get(token);
  if (!session) throw new AppError('登录已失效，请重新登录');
  const user = services.auth.currentUser(session.userId);
  if (!user || !user.is_active) {
    sessions.delete(token);
    throw new AppError('账号不可用，请重新登录');
  }
  return user;
}

function registerPublic(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      const data = await fn(payload);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof AppError ? err.message : String(err && err.message || err) };
    }
  });
}

function registerProtected(channel, fn) {
  ipcMain.handle(channel, async (_event, payload, token) => {
    try {
      const user = requireSession(token);
      const data = await fn(user, payload);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof AppError ? err.message : String(err && err.message || err) };
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#f5f7fb',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        sandbox: false
      }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) writeStartupLog(`RENDERER_ERROR ${message}`);
    if (process.env.STUDENT_MANAGER_SMOKE && level >= 2) console.error(`[renderer:${level}] ${message}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeStartupLog(`DID_FAIL_LOAD ${errorCode} ${errorDescription} ${validatedURL}`);
    if (process.env.STUDENT_MANAGER_SMOKE) console.error(`DID_FAIL_LOAD ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeStartupLog(`RENDER_GONE ${details.reason}`);
    if (process.env.STUDENT_MANAGER_SMOKE) console.error(`RENDER_GONE ${details.reason}`);
  });
  mainWindow.webContents.once('did-finish-load', () => {
    writeStartupLog('SMOKE_LOADED');
    if (process.env.STUDENT_MANAGER_SMOKE) {
      console.log('SMOKE_LOADED');
      if (process.env.STUDENT_MANAGER_E2E) {
        runE2E(mainWindow).finally(() => app.quit());
      } else {
        setTimeout(() => app.quit(), 2500);
      }
    }
  });
  if (process.env.STUDENT_MANAGER_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function runE2E(win) {
  const script = `
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const results = [];
      results.push(document.querySelector('#login-submit svg') ? 'ICON_OK' : 'ICON_FAIL');
      results.push(document.getElementById('login-remember') ? 'REMEMBER_OK' : 'REMEMBER_FAIL');
      document.getElementById('login-username').value = 'admin';
      document.getElementById('login-password').value = '123456';
      document.getElementById('login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await wait(900);
      results.push(document.getElementById('main-view').classList.contains('hidden') ? 'MAIN_NOT_SHOWN' : 'LOGIN_OK');
      document.querySelector('[data-page="students"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('学生管理') ? 'STUDENTS_OK' : 'STUDENTS_FAIL');
      results.push(document.getElementById('page-size-select') ? 'PAGE_SIZE_OK' : 'PAGE_SIZE_FAIL');
      results.push(document.getElementById('batch-delete-count') ? 'BATCH_COUNT_OK' : 'BATCH_COUNT_FAIL');
      results.push(document.getElementById('filter-archived') ? 'ARCHIVE_FILTER_OK' : 'ARCHIVE_FILTER_FAIL');
      results.push(document.querySelector('[data-action="students-batch-archive"]') ? 'BATCH_ARCHIVE_OK' : 'BATCH_ARCHIVE_FAIL');
      document.querySelector('[data-action="student-add"]').click();
      await wait(700);
      document.getElementById('f-name').value = 'E2E测试学生';
      document.getElementById('f-student_no').value = '20269999';
      document.getElementById('f-id_card').value = '110101209901019999';
      document.getElementById('f-class_name').value = 'E2E测试班';
      document.getElementById('f-phone').value = '13900000000';
      document.getElementById('f-birth_date').value = '2007-06-15';
      document.getElementById('f-poverty_status').value = '低保';
      document.getElementById('f-hardship_level').value = '特别困难';
      document.getElementById('f-scholarship_level').value = '一档';
      document.getElementById('save-student-btn').click();
      await wait(1100);
      results.push(document.getElementById('content').textContent.includes('E2E测试学生') ? 'CREATE_STUDENT_OK' : 'CREATE_STUDENT_FAIL');
      const detailBtn = [...document.querySelectorAll('[data-action="student-view"]')].find((btn) => btn.closest('tr') && btn.closest('tr').textContent.includes('E2E测试学生'));
      if (detailBtn) {
        detailBtn.click();
        await wait(700);
        results.push(document.querySelector('.detail-main') ? 'DETAIL_LAYOUT_OK' : 'DETAIL_LAYOUT_FAIL');
        results.push(document.querySelectorAll('.detail-main .detail-section').length >= 5 ? 'DETAIL_SECTIONS_OK' : 'DETAIL_SECTIONS_FAIL');
        results.push(document.body.textContent.includes('2007-06-15') && !document.body.textContent.includes('00:00:00') ? 'BIRTH_DATE_OK' : 'BIRTH_DATE_FAIL');
        const closeBtn = document.querySelector('[data-close-modal]');
        if (closeBtn) closeBtn.click();
        await wait(300);
      } else {
        results.push('DETAIL_LAYOUT_FAIL');
      }
      document.querySelector('[data-page="grades"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('成绩与综测') ? 'GRADES_OK' : 'GRADES_FAIL');
      document.querySelector('[data-page="discipline"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('处分记录') ? 'DISCIPLINE_OK' : 'DISCIPLINE_FAIL');
      document.querySelector('[data-page="rewards"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('奖励记录') ? 'REWARDS_OK' : 'REWARDS_FAIL');
      document.querySelector('[data-page="logs"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('操作日志') ? 'LOGS_OK' : 'LOGS_FAIL');
      document.querySelector('[data-page="dashboard"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('数据看板') ? 'DASHBOARD_OK' : 'DASHBOARD_FAIL');
      document.querySelector('[data-page="attendance"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('考勤管理') ? 'ATTENDANCE_OK' : 'ATTENDANCE_FAIL');
      results.push(document.querySelector('[data-action="attendance-batch-delete"]') ? 'ATTENDANCE_BATCH_OK' : 'ATTENDANCE_BATCH_FAIL');
      document.querySelector('[data-page="settings"]').click();
      await wait(700);
      results.push(document.getElementById('content').textContent.includes('学籍状态') ? 'SETTINGS_OK' : 'SETTINGS_FAIL');
      return results.join(',');
    })()
  `;
  try {
    const result = await win.webContents.executeJavaScript(script);
    console.log(`E2E_RESULT ${result}`);
    if (process.env.STUDENT_MANAGER_SCREENSHOT) {
      await win.webContents.executeJavaScript(`document.querySelector('[data-page="dashboard"]').click();`);
      await new Promise((resolve) => setTimeout(resolve, 800));
      const image = await win.webContents.capturePage();
      fs.writeFileSync(process.env.STUDENT_MANAGER_SCREENSHOT, image.toPNG());
      console.log(`SCREENSHOT_SAVED ${process.env.STUDENT_MANAGER_SCREENSHOT}`);
    }
  } catch (err) {
    console.error(`E2E_FAIL ${err && err.stack || err}`);
  }
}

function registerIpc() {
  registerPublic('auth:login', (payload) => {
    const user = services.auth.login(payload.username, payload.password);
    const token = crypto.randomUUID();
    sessions.set(token, { userId: user.id, username: user.username });
    return { token, user };
  });

  registerProtected('auth:logout', (user) => {
    services.logAction(user, '登出', '认证', 'user', user.id, `用户 ${user.username} 登出`);
  });
  registerProtected('auth:current', (user) => user);
  registerProtected('auth:changePassword', (user, payload) => {
    services.auth.changePassword(user, payload.oldPassword, payload.newPassword);
  });

  registerProtected('users:list', () => services.users.list());
  registerProtected('users:create', (user, payload) => services.users.create(user, payload));
  registerProtected('users:update', (user, payload) => services.users.update(user, payload));
  registerProtected('users:remove', (user, payload) => services.users.remove(user, payload.id));

  registerProtected('students:list', (user, payload) => services.students.list(payload || {}));
  registerProtected('students:listAll', (user, payload) => services.students.listAll(payload || {}));
  registerProtected('students:classes', (user, payload) => services.students.classes(payload?.includeArchived));
  registerProtected('students:getDetail', (user, payload) => services.students.getDetail(payload.id));
  registerProtected('students:create', (user, payload) => services.students.create(user, payload));
  registerProtected('students:update', (user, payload) => services.students.update(user, payload));
  registerProtected('students:remove', (user, payload) => services.students.remove(user, payload.id));
  registerProtected('students:batchRemove', (user, payload) => services.students.batchRemove(user, payload.ids));
  registerProtected('students:archive', (user, payload) => services.students.archive(user, payload.ids, payload.archived !== false));
  registerProtected('students:choosePhoto', async (user, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择学生照片',
      filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return services.students.savePhoto(user, payload.studentId, result.filePaths[0]);
  });

  registerProtected('excel:downloadTemplate', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存学生导入模板',
      defaultPath: path.join(app.getPath('documents'), '学生信息导入模板.xlsx'),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    excelLib.writeWorkbook(excelLib.buildTemplateWorkbook(), result.filePath);
    return result.filePath;
  });

  registerProtected('excel:import', async (user) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择学生信息 Excel 文件',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    const rows = excelLib.readImportRows(result.filePaths[0]);
    const report = services.students.importRows(user, rows);
    report.error_file = saveImportErrorReport(report);
    return report;
  });

  registerProtected('excel:export', async (user, payload) => {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '导出学生数据',
      defaultPath: path.join(app.getPath('documents'), `学生数据导出_${new Date().toISOString().slice(0, 10)}.xlsx`),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    let students = [];
    if (payload && Array.isArray(payload.studentIds) && payload.studentIds.length) {
      students = payload.studentIds.map((id) => services.students.get(id)).filter(Boolean);
    } else {
      students = services.students.listAll(payload || {});
    }
    excelLib.writeWorkbook(excelLib.buildExportWorkbook(students), saveResult.filePath);
    services.logAction(user, '导出学生', 'Excel', 'student', null, `导出 ${students.length} 条学生数据`);
    return saveResult.filePath;
  });

  registerProtected('grades:list', (user, payload) => services.grades.listByStudent(payload.studentId));
  registerProtected('grades:listAll', (user, payload) => services.grades.listAll(payload || {}));
  registerProtected('grades:get', (user, payload) => services.grades.get(payload.id));
  registerProtected('grades:create', (user, payload) => services.grades.create(user, payload));
  registerProtected('grades:update', (user, payload) => services.grades.update(user, payload));
  registerProtected('grades:remove', (user, payload) => services.grades.remove(user, payload.id));
  registerProtected('grades:listSummaries', (user, payload) => services.gradeSummaries.list(payload || {}));
  registerProtected('grades:getSummary', (user, payload) => services.gradeSummaries.get(payload.id));
  registerProtected('grades:createSummary', (user, payload) => services.gradeSummaries.create(user, payload));
  registerProtected('grades:updateSummary', (user, payload) => services.gradeSummaries.update(user, payload));
  registerProtected('grades:removeSummary', (user, payload) => services.gradeSummaries.remove(user, payload.id));
  registerProtected('grades:import', async (user, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择成绩汇总 Excel 文件',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    const rows = excelLib.readGradeSummaryRows(result.filePaths[0]);
    const report = services.gradeSummaries.importRows(user, rows, payload?.semester || '');
    report.error_file = saveImportErrorReport(report);
    return report;
  });
  registerProtected('grades:exportSummaries', async (user, payload) => {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '导出成绩汇总',
      defaultPath: path.join(app.getPath('documents'), `成绩汇总导出_${new Date().toISOString().slice(0, 10)}.xlsx`),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    const records = services.gradeSummaries.list(payload || {});
    excelLib.writeWorkbook(excelLib.buildGradeSummaryExportWorkbook(records), saveResult.filePath);
    services.logAction(user, '导出成绩汇总', 'Excel', 'grade_summary', null, `导出 ${records.length} 条成绩汇总`);
    return saveResult.filePath;
  });

  registerProtected('evaluations:list', (user, payload) => services.evaluations.listByStudent(payload.studentId));
  registerProtected('evaluations:listAll', (user, payload) => services.evaluations.listAll(payload || {}));
  registerProtected('evaluations:get', (user, payload) => services.evaluations.get(payload.id));
  registerProtected('evaluations:create', (user, payload) => services.evaluations.create(user, payload));
  registerProtected('evaluations:update', (user, payload) => services.evaluations.update(user, payload));
  registerProtected('evaluations:remove', (user, payload) => services.evaluations.remove(user, payload.id));
  registerProtected('evaluations:import', async (user, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择综测 Excel 文件',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    const rows = excelLib.readEvaluationRows(result.filePaths[0]);
    const report = services.evaluations.importRows(user, rows, payload?.academicYear || '');
    report.error_file = saveImportErrorReport(report);
    return report;
  });
  registerProtected('evaluations:export', async (user, payload) => {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '导出综测数据',
      defaultPath: path.join(app.getPath('documents'), `综测导出_${new Date().toISOString().slice(0, 10)}.xlsx`),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    const records = services.evaluations.listAll(payload || {});
    excelLib.writeWorkbook(excelLib.buildEvaluationExportWorkbook(records), saveResult.filePath);
    services.logAction(user, '导出综测', 'Excel', 'evaluation', null, `导出 ${records.length} 条综测数据`);
    return saveResult.filePath;
  });

  registerProtected('attendance:list', (user, payload) => services.attendance.list(payload || {}));
  registerProtected('attendance:get', (user, payload) => services.attendance.get(payload.id));
  registerProtected('attendance:cumulative', (user, payload) => services.attendance.cumulativeStats(payload?.semester || ''));
  registerProtected('attendance:stats', (user, payload) => services.attendance.stats(payload.studentId, payload.semester));
  registerProtected('attendance:create', (user, payload) => services.attendance.create(user, payload));
  registerProtected('attendance:update', (user, payload) => services.attendance.update(user, payload));
  registerProtected('attendance:remove', (user, payload) => services.attendance.remove(user, payload.id));
  registerProtected('attendance:batchRemove', (user, payload) => services.attendance.batchRemove(user, payload.ids));
  registerProtected('attendance:import', async (user, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择考勤 Excel 文件',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    const rows = excelLib.readAttendanceRows(result.filePaths[0]);
    const report = services.attendance.importRows(user, rows, payload?.semester || '');
    report.error_file = saveImportErrorReport(report);
    return report;
  });
  registerProtected('attendance:export', async (user, payload) => {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '导出考勤数据',
      defaultPath: path.join(app.getPath('documents'), `考勤数据导出_${new Date().toISOString().slice(0, 10)}.xlsx`),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    const records = services.attendance.list(payload || {});
    excelLib.writeWorkbook(excelLib.buildAttendanceExportWorkbook(records), saveResult.filePath);
    services.logAction(user, '导出考勤', 'Excel', 'attendance', null, `导出 ${records.length} 条考勤数据`);
    return saveResult.filePath;
  });

  registerProtected('discipline:list', (user, payload) => services.discipline.list(payload || {}));
  registerProtected('discipline:get', (user, payload) => services.discipline.get(payload.id));
  registerProtected('discipline:create', (user, payload) => services.discipline.create(user, payload));
  registerProtected('discipline:update', (user, payload) => services.discipline.update(user, payload));
  registerProtected('discipline:remove', (user, payload) => services.discipline.remove(user, payload.id));
  registerProtected('discipline:import', async (user) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择处分 Excel 文件',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    const rows = excelLib.readDisciplineRows(result.filePaths[0]);
    const report = services.discipline.importRows(user, rows);
    report.error_file = saveImportErrorReport(report);
    return report;
  });
  registerProtected('discipline:export', async (user, payload) => {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '导出处分记录',
      defaultPath: path.join(app.getPath('documents'), `处分记录导出_${new Date().toISOString().slice(0, 10)}.xlsx`),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    const records = services.discipline.list(payload || {});
    excelLib.writeWorkbook(excelLib.buildDisciplineExportWorkbook(records), saveResult.filePath);
    services.logAction(user, '导出处分', 'Excel', 'discipline', null, `导出 ${records.length} 条处分记录`);
    return saveResult.filePath;
  });

  registerProtected('rewards:list', (user, payload) => services.rewards.list(payload || {}));
  registerProtected('rewards:get', (user, payload) => services.rewards.get(payload.id));
  registerProtected('rewards:create', (user, payload) => services.rewards.create(user, payload));
  registerProtected('rewards:update', (user, payload) => services.rewards.update(user, payload));
  registerProtected('rewards:remove', (user, payload) => services.rewards.remove(user, payload.id));
  registerProtected('rewards:import', async (user) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择奖励 Excel 文件',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    const rows = excelLib.readRewardRows(result.filePaths[0]);
    const report = services.rewards.importRows(user, rows);
    report.error_file = saveImportErrorReport(report);
    return report;
  });
  registerProtected('rewards:export', async (user, payload) => {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '导出奖励记录',
      defaultPath: path.join(app.getPath('documents'), `奖励记录导出_${new Date().toISOString().slice(0, 10)}.xlsx`),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return null;
    const records = services.rewards.list(payload || {});
    excelLib.writeWorkbook(excelLib.buildRewardExportWorkbook(records), saveResult.filePath);
    services.logAction(user, '导出奖励', 'Excel', 'reward', null, `导出 ${records.length} 条奖励记录`);
    return saveResult.filePath;
  });

  registerProtected('dashboard:stats', () => services.dashboard.stats());
  registerProtected('logs:list', (user, payload) => services.logs.list(payload || {}));

  registerProtected('settings:statuses', () => services.settings.listStatuses());
  registerProtected('settings:createStatus', (user, payload) => services.settings.createStatus(user, payload));
  registerProtected('settings:updateStatus', (user, payload) => services.settings.updateStatus(user, payload));
  registerProtected('settings:removeStatus', (user, payload) => services.settings.removeStatus(user, payload.id));

  registerProtected('clipboard:writeText', (user, payload) => {
    clipboard.writeText(String(payload.text ?? ''));
  });

  registerProtected('excel:downloadGradeSummaryTemplate', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存成绩汇总导入模板',
      defaultPath: path.join(app.getPath('documents'), '成绩汇总导入模板.xlsx'),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    excelLib.writeWorkbook(excelLib.buildGradeSummaryTemplateWorkbook(), result.filePath);
    return result.filePath;
  });

  registerProtected('excel:downloadEvaluationTemplate', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存综测导入模板',
      defaultPath: path.join(app.getPath('documents'), '综测导入模板.xlsx'),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    excelLib.writeWorkbook(excelLib.buildEvaluationTemplateWorkbook(), result.filePath);
    return result.filePath;
  });

  registerProtected('excel:downloadAttendanceTemplate', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存考勤导入模板',
      defaultPath: path.join(app.getPath('documents'), '考勤导入模板.xlsx'),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    excelLib.writeWorkbook(excelLib.buildAttendanceTemplateWorkbook(), result.filePath);
    return result.filePath;
  });

  registerProtected('excel:downloadDisciplineTemplate', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存处分导入模板',
      defaultPath: path.join(app.getPath('documents'), '处分导入模板.xlsx'),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    excelLib.writeWorkbook(excelLib.buildDisciplineTemplateWorkbook(), result.filePath);
    return result.filePath;
  });

  registerProtected('excel:downloadRewardTemplate', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存奖励导入模板',
      defaultPath: path.join(app.getPath('documents'), '奖励导入模板.xlsx'),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    excelLib.writeWorkbook(excelLib.buildRewardTemplateWorkbook(), result.filePath);
    return result.filePath;
  });
}

app.whenReady().then(() => {
  writeStartupLog('APP_READY');
  if (process.env.STUDENT_MANAGER_SMOKE) console.log('APP_READY');
  try {
    ctx = createDatabase(dataDir);
    services = createServices(ctx);
    registerIpc();
    createWindow();
  } catch (err) {
    writeStartupLog(`STARTUP_FAILED ${err && err.stack || err}`);
    dialog.showErrorBox('启动失败', String(err && err.message || err));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  writeStartupLog('BEFORE_QUIT');
  if (ctx) ctx.close();
});
