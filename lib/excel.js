const path = require('node:path');
const XLSX = require('xlsx');

const STUDENT_HEADERS = [
  ['姓名', 'name'],
  ['学号', 'student_no'],
  ['身份证号码', 'id_card'],
  ['年级', 'grade'],
  ['学制', 'school_years'],
  ['专业', 'major'],
  ['班级', 'class_name'],
  ['政治面貌', 'political_status'],
  ['性别', 'gender'],
  ['学生手机号', 'phone'],
  ['所住社区', 'community'],
  ['所住寝室号', 'dorm_room'],
  ['所住床位', 'bed_no'],
  ['出生日期', 'birth_date'],
  ['民族', 'ethnicity'],
  ['户籍地址', 'household_address'],
  ['实际居住地址', 'current_address'],
  ['父亲姓名', 'father_name'],
  ['父亲电话', 'father_phone'],
  ['母亲姓名', 'mother_name'],
  ['母亲电话', 'mother_phone'],
  ['紧急备用联系人姓名', 'emergency_name'],
  ['紧急备用联系人电话', 'emergency_phone'],
  ['个人特长', 'talents'],
  ['贫困户标记', 'poverty_status'],
  ['困难认定等级', 'hardship_level'],
  ['助学金等级', 'scholarship_level'],
  ['学籍状态', 'enrollment_status'],
  ['辅导员', 'counselor'],
  ['照片路径', 'photo_path']
];

const HEADER_LABELS = STUDENT_HEADERS.map(([label]) => label);
const FIELD_KEYS = STUDENT_HEADERS.map(([, key]) => key);
const LABEL_TO_KEY = Object.fromEntries(STUDENT_HEADERS);

const GRADE_SUMMARY_HEADERS = [
  ['学期', 'semester'],
  ['名次', 'rank'],
  ['学号', 'student_no'],
  ['姓名', 'name'],
  ['性别', 'gender'],
  ['行政班级', 'admin_class'],
  ['修读课程环节数', 'course_count'],
  ['未通过课程环节数', 'failed_course_count'],
  ['修读学分', 'credits_taken'],
  ['获得学分', 'credits_earned'],
  ['绩点', 'gpa'],
  ['学分绩点', 'credit_gpa'],
  ['平均学分绩点', 'avg_gpa'],
  ['平均成绩', 'avg_score'],
  ['班级', 'class_name']
];

const EVALUATION_HEADERS = [
  ['学年', 'academic_year'],
  ['学号', 'student_no'],
  ['姓名', 'name'],
  ['总得分', 'total_score'],
  ['加分', 'add_points'],
  ['减分', 'deduct_points'],
  ['备注', 'notes']
];

const ATTENDANCE_HEADERS = [
  ['学号', 'student_no'],
  ['姓名', 'name'],
  ['日期', 'attendance_date'],
  ['学期', 'semester'],
  ['周次', 'week_no'],
  ['开始节次', 'start_period'],
  ['结束节次', 'end_period'],
  ['考勤类型', 'attendance_type'],
  ['备注', 'notes']
];

const DISCIPLINE_HEADERS = [
  ['学号', 'student_no'],
  ['姓名', 'name'],
  ['处分类型', 'punishment_type'],
  ['处分原因', 'reason'],
  ['处分时间', 'punishment_date'],
  ['当前状态', 'status'],
  ['撤销时间', 'revoke_date'],
  ['备注', 'notes']
];

const REWARD_HEADERS = [
  ['学号', 'student_no'],
  ['姓名', 'name'],
  ['奖项名称', 'award_name'],
  ['颁发单位', 'issuer'],
  ['获奖时间', 'award_date'],
  ['备注', 'notes']
];

function buildTemplateWorkbook() {
  const aoa = [HEADER_LABELS, []];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = STUDENT_HEADERS.map(([label]) => ({ wch: Math.max(label.length + 4, 12) }));

  const guide = XLSX.utils.aoa_to_sheet([
    ['学生信息批量导入填写说明'],
    [],
    ['1. 请在第 2 行起逐行填写，不要修改第 1 行表头。'],
    ['2. 姓名、学号、身份证号码、班级、学生手机号为必填项。'],
    ['3. 学号或身份证号码已存在时，该行会被跳过并在导入报告中提示。'],
    ['4. 照片路径可填写本机图片文件的完整路径；留空表示不导入照片。'],
    ['5. 年级示例：2025、2026；学制可选：2、3、4、5。'],
    ['6. 政治面貌建议使用：群众、共青团员、中国共产党预备党员、中国共产党党员。'],
    ['7. 学籍状态需先在“设置”中存在，未填写时显示为空。']
  ]);
  guide['!cols'] = [{ wch: 110 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '学生信息');
  XLSX.utils.book_append_sheet(workbook, guide, '填写说明');
  return workbook;
}

function readImportRows(filePath) {
  return readMappedRows(filePath, STUDENT_HEADERS, '学生信息');
}

function readMappedRows(filePath, headerMap, preferredSheet) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.find((name) => name === preferredSheet) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!raw.length) return [];
  const headerRow = raw[0].map((value) => String(value).trim());
  const labelToKey = Object.fromEntries(headerMap);
  const keyIndexes = headerRow.map((label) => labelToKey[label] || null);
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const line = raw[i];
    if (!Array.isArray(line) || line.every((value) => String(value ?? '').trim() === '')) continue;
    const row = {};
    keyIndexes.forEach((key, index) => {
      if (key) row[key] = line[index] === undefined ? '' : String(line[index]).trim();
    });
    rows.push(row);
  }
  return rows;
}

function readGradeSummaryRows(filePath) {
  return readMappedRows(filePath, GRADE_SUMMARY_HEADERS, '成绩');
}

function readEvaluationRows(filePath) {
  return readMappedRows(filePath, EVALUATION_HEADERS, '综测');
}

function readAttendanceRows(filePath) {
  return readMappedRows(filePath, ATTENDANCE_HEADERS, '考勤');
}

function readDisciplineRows(filePath) {
  return readMappedRows(filePath, DISCIPLINE_HEADERS, '处分');
}

function readRewardRows(filePath) {
  return readMappedRows(filePath, REWARD_HEADERS, '奖励');
}

function buildTemplateWorkbookFrom(headers, sheetName, guideLines) {
  const aoa = [headers.map(([label]) => label), []];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = headers.map(([label]) => ({ wch: Math.max(label.length + 4, 12) }));
  const guide = XLSX.utils.aoa_to_sheet([
    ['填写说明'],
    [],
    ...guideLines.map((line) => [line])
  ]);
  guide['!cols'] = [{ wch: 110 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.utils.book_append_sheet(workbook, guide, '填写说明');
  return workbook;
}

function buildGradeSummaryTemplateWorkbook() {
  return buildTemplateWorkbookFrom(GRADE_SUMMARY_HEADERS, '成绩', [
    '1. 学号必填，用于匹配学生档案。',
    '2. 学期可填写在“学期”列；留空时使用导入时选择的学期。',
    '3. 名次、修读课程环节数、未通过课程环节数填写整数。',
    '4. 学分、绩点、平均成绩等填写数字，可保留小数。'
  ]);
}

function buildEvaluationTemplateWorkbook() {
  return buildTemplateWorkbookFrom(EVALUATION_HEADERS, '综测', [
    '1. 学号必填，用于匹配学生档案。',
    '2. 学年可填写在“学年”列；留空时使用导入时选择的学年。',
    '3. 总得分、加分、减分填写数字。'
  ]);
}

function buildAttendanceTemplateWorkbook() {
  return buildTemplateWorkbookFrom(ATTENDANCE_HEADERS, '考勤', [
    '1. 学号必填，用于匹配学生档案。',
    '2. 考勤类型填写：旷课、迟到、早退。',
    '3. 开始节次和结束节次填写正整数，结束节次不能小于开始节次。',
    '4. 旷课学时按节次跨度计算；迟到、早退每 3 次折算 1 个旷课学时。'
  ]);
}

function buildDisciplineTemplateWorkbook() {
  return buildTemplateWorkbookFrom(DISCIPLINE_HEADERS, '处分', [
    '1. 学号必填，用于匹配学生档案。',
    '2. 处分类型填写：通报批评、警告、严重警告、记过、留校察看、开除学籍。',
    '3. 当前状态填写：处分中、撤销流程中、已撤销。'
  ]);
}

function buildRewardTemplateWorkbook() {
  return buildTemplateWorkbookFrom(REWARD_HEADERS, '奖励', [
    '1. 学号必填，用于匹配学生档案。',
    '2. 获奖时间支持年月或年月日格式。'
  ]);
}

function buildExportWorkbookFrom(headers, rows, sheetName) {
  const aoa = [
    headers.map(([label]) => label),
    ...rows.map((row) => headers.map(([, key]) => {
      const value = row[key];
      return value === null || value === undefined ? '' : String(value);
    }))
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = headers.map(([label]) => ({ wch: Math.max(label.length + 4, 12) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return workbook;
}

function buildAttendanceExportWorkbook(records) {
  return buildExportWorkbookFrom(ATTENDANCE_HEADERS, records, '考勤');
}

function buildDisciplineExportWorkbook(records) {
  return buildExportWorkbookFrom(DISCIPLINE_HEADERS, records, '处分');
}

function buildRewardExportWorkbook(records) {
  return buildExportWorkbookFrom(REWARD_HEADERS, records, '奖励');
}

function buildGradeSummaryExportWorkbook(records) {
  return buildExportWorkbookFrom(GRADE_SUMMARY_HEADERS, records, '成绩');
}

function buildEvaluationExportWorkbook(records) {
  return buildExportWorkbookFrom(EVALUATION_HEADERS, records, '综测');
}

function buildImportErrorWorkbook(report) {
  const rows = (report.skipped || []).map((item) => ({
    line: item.line,
    student_no: item.student_no,
    name: item.name,
    reason: item.reason,
    raw: item.raw || ''
  }));
  return buildExportWorkbookFrom([
    ['Excel行', 'line'],
    ['学号', 'student_no'],
    ['姓名', 'name'],
    ['错误信息', 'reason'],
    ['原始数据', 'raw']
  ], rows, '导入错误');
}

function studentsToAoa(students) {
  return [
    HEADER_LABELS,
    ...students.map((student) => FIELD_KEYS.map((key) => {
      if (key === 'photo_path') return student.photo_path || '';
      const value = student[key];
      return value === null || value === undefined ? '' : String(value);
    }))
  ];
}

function buildExportWorkbook(students) {
  const aoa = studentsToAoa(students);
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = STUDENT_HEADERS.map(([label]) => ({ wch: Math.max(label.length + 4, 12) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '学生信息');
  return workbook;
}

function writeWorkbook(workbook, filePath) {
  XLSX.writeFile(workbook, filePath);
}

module.exports = {
  STUDENT_HEADERS,
  HEADER_LABELS,
  buildTemplateWorkbook,
  readImportRows,
  readGradeSummaryRows,
  readEvaluationRows,
  readAttendanceRows,
  readDisciplineRows,
  readRewardRows,
  buildGradeSummaryTemplateWorkbook,
  buildEvaluationTemplateWorkbook,
  buildAttendanceTemplateWorkbook,
  buildDisciplineTemplateWorkbook,
  buildRewardTemplateWorkbook,
  buildAttendanceExportWorkbook,
  buildDisciplineExportWorkbook,
  buildRewardExportWorkbook,
  buildGradeSummaryExportWorkbook,
  buildEvaluationExportWorkbook,
  buildImportErrorWorkbook,
  buildExportWorkbook,
  writeWorkbook
};
