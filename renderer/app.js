const $ = (selector) => document.querySelector(selector);

const state = {
  user: null,
  page: 'dashboard',
  studentsFilters: { keyword: '', keywordType: 'any', className: '', enrollmentStatus: '', archived: '0', page: 1, pageSize: 20 },
  batchDeleteCount: 20,
  selectedStudentIds: new Set(),
  gradeStudent: null,
  gradesKeyword: '',
  gradesFilters: { keyword: '', semester: '', academicYear: '' },
  attendanceFilters: { keyword: '', semester: '' },
  attendanceStudent: null,
  selectedAttendanceIds: new Set(),
  disciplineFilters: { keyword: '', punishmentType: '', status: '' },
  disciplineStudent: null,
  rewardFilters: { keyword: '', awardName: '' },
  rewardStudent: null,
  logFilters: { keyword: '', page: 1, pageSize: 30 },
  modalStudent: null
};

const POLITICAL_STATUSES = ['群众', '共青团员', '中国共产党预备党员', '中国共产党党员'];
const GENDERS = ['男', '女'];
const POVERTY_STATUSES = ['', '脱贫户（建卡立档贫困户）', '低保', '特困救助供养家庭学生', '残疾', '孤儿', '其他'];
const DISCIPLINE_TYPES = ['通报批评', '警告', '严重警告', '记过', '留校察看', '开除学籍'];
const DISCIPLINE_STATUSES = ['处分中', '撤销流程中', '已撤销'];
const REMEMBER_KEY = 'student_manager_remember';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function formatDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return text;
}

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function refreshIcons() {
  if (!window.lucide) return;
  document.querySelectorAll('i[data-lucide]').forEach((el) => {
    const name = el.getAttribute('data-lucide');
    const key = name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    const iconNode = lucide.icons[key];
    if (!iconNode) return;
    const svg = lucide.createElement(iconNode);
    svg.setAttribute('data-lucide', name);
    svg.setAttribute('aria-hidden', 'true');
    el.replaceWith(svg);
  });
}

function toast(message, type = '') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function setLoading(show) {
  $('#loading-overlay').classList.toggle('hidden', !show);
}

function openModal(html, options = {}) {
  const classes = ['modal'];
  if (options.wide) classes.push('wide');
  if (options.narrow) classes.push('narrow');
  $('#modal-root').innerHTML = `<div class="modal-overlay"><div class="${classes.join(' ')}">${html}</div></div>`;
  refreshIcons();
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function modalShell(title, body, foot = '', options = {}) {
  return `
    <div class="modal-head">
      <h3>${esc(title)}</h3>
      <button type="button" class="btn btn-sm" data-close-modal>${icon('x')}关闭</button>
    </div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
  `;
}

function confirmDialog(title, message) {
  return new Promise((resolve) => {
    openModal(modalShell(title, `<p>${esc(message)}</p>`, `
      <button type="button" class="btn" data-confirm-no>取消</button>
      <button type="button" class="btn btn-danger" data-confirm-yes>${icon('trash-2')}确认删除</button>
    `, { narrow: true }));
    $('#modal-root').addEventListener('click', function handler(event) {
      if (event.target.closest('[data-close-modal]') || event.target.closest('[data-confirm-no]')) {
        closeModal();
        resolve(false);
      } else if (event.target.closest('[data-confirm-yes]')) {
        closeModal();
        resolve(true);
      }
    });
  });
}

function optionsHtml(values, selected = '') {
  return values.map((value) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(value || '未填写')}</option>`).join('');
}

function barListHtml(items, color = '') {
  if (!items.length) return '<div class="empty-state">暂无数据</div>';
  const max = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  return `<div class="bar-list">${items.map((item) => {
    const width = Math.max((Number(item.value) || 0) / max * 100, (item.value ? 5 : 0));
    return `<div class="bar-row"><span>${esc(item.label)}</span><div class="bar-track"><div class="bar-fill ${color}" style="width:${width}%"></div></div><span>${Number(item.value) || 0}</span></div>`;
  }).join('')}</div>`;
}

function classBoardHtml(items) {
  if (!items || !items.length) return '<div class="empty-state">暂无班级数据</div>';
  const rows = items.map((item) => {
    const total = Number(item.value) || 0;
    const active = Number(item.active_value) || 0;
    const percent = total ? Math.round(active / total * 100) : 0;
    return `
      <tr>
        <td><strong>${esc(item.label)}</strong></td>
        <td>${active}</td>
        <td>${total}</td>
        <td>
          <div class="bar-track board-bar"><div class="bar-fill" style="width:${percent}%"></div></div>
          <span class="board-percent">${percent}%</span>
        </td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>班级</th><th>在读人数</th><th>全部人数</th><th>在读占比</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

const DONUT_COLORS = ['#ec4899', '#a78bfa', '#2dd4bf', '#fb923c', '#facc15', '#34d399', '#f87171'];

function donutChartHtml(items) {
  if (!items.length) return '<div class="empty-state">暂无数据</div>';
  const total = Math.max(items.reduce((sum, item) => sum + (Number(item.value) || 0), 0), 1);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    const value = Number(item.value) || 0;
    cursor += value / total * 100;
    const color = DONUT_COLORS[index % DONUT_COLORS.length];
    return { ...item, value, color, start, end: cursor };
  });
  const gradient = segments.map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`).join(', ');
  return `
    <div class="donut-wrap">
      <div class="donut" style="background: conic-gradient(${gradient});">
        <div class="donut-hole"></div>
      </div>
      <div class="donut-legend">
        ${segments.map((segment) => `<div class="legend-row"><span class="legend-color" style="background:${segment.color}"></span><span>${esc(segment.label)}</span><strong>${segment.value}</strong></div>`).join('')}
      </div>
    </div>
  `;
}

function studentPhotoHtml(student, size = 'photo-cell') {
  if (student && student.photo_url) return `<img class="${size}" src="${esc(student.photo_url)}" alt="学生照片">`;
  return `<span class="photo-placeholder" style="${size === 'detail-photo' ? 'width:130px;height:160px;' : ''}">${icon('user')}</span>`;
}

function studentPickerHtml() {
  return `
    <div class="field span-3">
      <span>选择学生</span>
      <div class="picker-row">
        <input id="modal-student-search" placeholder="输入姓名 / 学号 / 身份证">
        <button type="button" class="btn" id="modal-find-student">${icon('search')}查找</button>
        <span id="modal-selected-student" class="picker-selected">${state.modalStudent ? esc(`${state.modalStudent.name}（${state.modalStudent.student_no}）`) : '未选择'}</span>
      </div>
      <div id="modal-student-results"></div>
    </div>
  `;
}

function bindModalStudentPicker() {
  $('#modal-find-student').addEventListener('click', async () => {
    const keyword = $('#modal-student-search').value.trim();
    if (!keyword) {
      toast('请输入学生关键字', 'error');
      return;
    }
    try {
      const result = await api.students.list({ keyword, keywordType: 'any', page: 1, pageSize: 20 });
      $('#modal-student-results').innerHTML = result.items.length ? `
        <div class="picker-results">
          ${result.items.map((s) => `<button type="button" class="btn btn-sm" data-action="modal-pick-student" data-id="${s.id}" data-name="${esc(s.name)}" data-no="${esc(s.student_no)}">${esc(s.name)}（${esc(s.student_no)}）</button>`).join('')}
        </div>
      ` : '<div class="empty-state" style="padding:10px">未找到学生</div>';
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#modal-student-results').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="modal-pick-student"]');
    if (!btn) return;
    state.modalStudent = { id: Number(btn.dataset.id), name: btn.dataset.name, student_no: btn.dataset.no };
    $('#modal-selected-student').textContent = `${state.modalStudent.name}（${state.modalStudent.student_no}）`;
    $('#modal-student-results').innerHTML = '';
  });
}

function paginationHtml(total, page, pageSize, actionPrefix) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `
    <div class="pagination">
      <span>共 ${total} 条</span>
      <button class="btn btn-sm" data-action="${actionPrefix}-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pages} 页</span>
      <button class="btn btn-sm" data-action="${actionPrefix}-page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button>
    </div>
  `;
}

function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#main-view').classList.add('hidden');
  applyRememberedLogin();
  $('#login-username').focus();
  refreshIcons();
}

function applyRememberedLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
    if (saved && saved.username) {
      $('#login-username').value = saved.username;
      $('#login-password').value = saved.password || '';
      $('#login-remember').checked = true;
    }
  } catch {
    localStorage.removeItem(REMEMBER_KEY);
  }
}

function showMain() {
  $('#login-view').classList.add('hidden');
  $('#main-view').classList.remove('hidden');
  $('#current-user-name').textContent = state.user.display_name || state.user.username;
  $('#current-user-username').textContent = state.user.username;
  $('#current-user-avatar').textContent = (state.user.display_name || state.user.username).slice(0, 1).toUpperCase();
  navigate(state.page);
}

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  renderPage(page);
}

async function renderPage(page) {
  setLoading(true);
  try {
    if (page === 'dashboard') await renderDashboard();
    else if (page === 'students') await renderStudentsPage();
    else if (page === 'grades') await renderGradesPage();
    else if (page === 'attendance') await renderAttendancePage();
    else if (page === 'discipline') await renderDisciplinePage();
    else if (page === 'rewards') await renderRewardsPage();
    else if (page === 'logs') await renderLogsPage();
    else if (page === 'settings') await renderSettingsPage();
  } catch (err) {
    toast(err.message || '页面加载失败', 'error');
  } finally {
    setLoading(false);
    refreshIcons();
  }
}

async function renderDashboard() {
  const stats = await api.dashboard.stats();
  const classCounts = stats.class_counts || [];
  const politicalCounts = stats.political_counts || [];
  const genderCounts = stats.gender_counts || [];
  const enrollmentCounts = stats.enrollment_counts || [];
  const genderFemale = genderCounts.find((item) => item.label === '女');
  const genderMale = genderCounts.find((item) => item.label === '男');

  $('#content').innerHTML = `
    <div class="page-head">
      <div>
        <h2>数据看板</h2>
        <p>总人数只统计设置为“计入总人数”的在读学籍状态。</p>
      </div>
      <div class="page-actions">
        <button class="btn" data-action="refresh-dashboard">${icon('refresh-cw')}刷新</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">在读总人数</div>
        <div class="stat-value">${stats.total_counted}</div>
        <div class="stat-note">按学籍状态实时统计</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">全部学生</div>
        <div class="stat-value">${stats.total_all}</div>
        <div class="stat-note">包含所有学籍状态</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">班级数</div>
        <div class="stat-value">${classCounts.length}</div>
        <div class="stat-note">当前学生所在班级</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">男生 / 女生</div>
        <div class="stat-value">${genderMale ? genderMale.value : 0} / ${genderFemale ? genderFemale.value : 0}</div>
        <div class="stat-note">未填写性别单独统计</div>
      </div>
    </div>
    <div class="panel">
      <h3 class="panel-title">各班级人数看板</h3>
      ${classBoardHtml(stats.class_board)}
    </div>
    <div class="charts-grid">
      <div class="chart-card"><h3>各班人数</h3>${barListHtml(classCounts)}</div>
      <div class="chart-card"><h3>政治面貌人数</h3>${donutChartHtml(politicalCounts)}</div>
      <div class="chart-card"><h3>性别人数</h3>${donutChartHtml(genderCounts)}</div>
      <div class="chart-card"><h3>学籍状态分布</h3>${barListHtml(enrollmentCounts, 'red')}</div>
    </div>
  `;
}

async function renderStudentsPage() {
  const filters = state.studentsFilters;
  const [list, classes, statuses] = await Promise.all([
    api.students.list(filters),
    api.students.classes(filters.archived === '1'),
    api.settings.statuses()
  ]);
  const rows = list.items.map((student) => `
    <tr>
      <td><input type="checkbox" class="student-check" data-id="${student.id}" ${state.selectedStudentIds.has(student.id) ? 'checked' : ''}></td>
      <td>${studentPhotoHtml(student)}</td>
      <td><strong>${esc(student.name)}</strong></td>
      <td>${esc(student.student_no)}</td>
      <td>${esc(student.id_card)}</td>
      <td>${esc(student.class_name)}</td>
      <td>${esc(student.gender || '')}</td>
      <td>${esc(student.political_status || '')}</td>
      <td>${esc(student.phone)}</td>
      <td>${student.is_archived ? '<span class="badge">已归档</span>' : ''}<span class="badge ${student.enrollment_status === '在读' ? 'badge-green' : 'badge-amber'}">${esc(student.enrollment_status || '未设置')}</span></td>
      <td>
        <button class="btn btn-sm" data-action="student-view" data-id="${student.id}">${icon('eye')}查看</button>
        <button class="btn btn-sm" data-action="student-edit" data-id="${student.id}">${icon('pencil')}编辑</button>
        ${student.is_archived
          ? `<button class="btn btn-sm" data-action="student-restore" data-id="${student.id}">${icon('archive-restore')}恢复</button>`
          : `<button class="btn btn-sm" data-action="student-archive" data-id="${student.id}">${icon('archive')}归档</button>`}
        <button class="btn btn-sm btn-danger" data-action="student-delete" data-id="${student.id}">${icon('trash-2')}删除</button>
      </td>
    </tr>
  `).join('');

  $('#content').innerHTML = `
    <div class="page-head">
      <div>
        <h2>学生管理</h2>
        <p>按班级分类存储，支持学号、姓名、身份证号码、政治面貌查询。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" data-action="student-add">${icon('user-plus')}新增学生</button>
        <button class="btn" data-action="excel-template">${icon('file-down')}下载模板</button>
        <button class="btn" data-action="excel-import">${icon('file-up')}导入 Excel</button>
        <button class="btn btn-success" data-action="excel-export">${icon('download')}导出 Excel</button>
        ${filters.archived !== '1' ? `<button class="btn" data-action="students-batch-archive">${icon('archive')}批量归档</button>` : ''}
        ${filters.archived === '1' ? `<button class="btn" data-action="students-batch-restore">${icon('archive-restore')}批量恢复</button>` : ''}
        <button class="btn btn-danger" data-action="students-batch-delete">${icon('trash-2')}批量删除</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field">
        <span>查询方式</span>
        <select id="filter-keyword-type">
          <option value="any" ${filters.keywordType === 'any' ? 'selected' : ''}>四类任选</option>
          <option value="student_no" ${filters.keywordType === 'student_no' ? 'selected' : ''}>学号</option>
          <option value="name" ${filters.keywordType === 'name' ? 'selected' : ''}>姓名</option>
          <option value="id_card" ${filters.keywordType === 'id_card' ? 'selected' : ''}>身份证号</option>
          <option value="political_status" ${filters.keywordType === 'political_status' ? 'selected' : ''}>政治面貌</option>
        </select>
      </div>
      <div class="field">
        <span>关键字</span>
        <input id="filter-keyword" type="text" value="${esc(filters.keyword)}" placeholder="输入关键字">
      </div>
      <div class="field">
        <span>班级</span>
        <select id="filter-class"><option value="">全部班级</option>${optionsHtml(classes, filters.className)}</select>
      </div>
      <div class="field">
        <span>学籍状态</span>
        <select id="filter-status"><option value="">全部状态</option>${optionsHtml(statuses.map((s) => s.label), filters.enrollmentStatus)}</select>
      </div>
      <div class="field">
        <span>归档状态</span>
        <select id="filter-archived">
          <option value="0" ${filters.archived === '0' ? 'selected' : ''}>未归档</option>
          <option value="1" ${filters.archived === '1' ? 'selected' : ''}>已归档</option>
          <option value="all" ${filters.archived === 'all' ? 'selected' : ''}>全部</option>
        </select>
      </div>
      <div class="field">
        <span>批量删除条数</span>
        <input id="batch-delete-count" type="number" min="1" max="500" value="${state.batchDeleteCount}">
      </div>
      <div class="field">
        <span>每页条数</span>
        <input id="page-size-select" type="number" min="1" max="500" value="${filters.pageSize}">
      </div>
      <button class="btn btn-primary" data-action="students-query">${icon('search')}查询</button>
      <button class="btn" data-action="students-reset">${icon('rotate-ccw')}重置</button>
    </div>
    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" id="student-check-all"></th>
              <th>照片</th><th>姓名</th><th>学号</th><th>身份证号码</th><th>班级</th><th>性别</th><th>政治面貌</th><th>手机号</th><th>学籍状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="11"><div class="empty-state">暂无学生数据</div></td></tr>'}</tbody>
        </table>
      </div>
      ${paginationHtml(list.total, list.page, list.pageSize, 'students')}
    </div>
  `;
}

function studentFormHtml(student, statuses) {
  const value = (key) => student ? student[key] || '' : '';
  const field = (key, label, type = 'text', options = null, span = 1, required = false) => `
    <div class="field span-${span}">
      <label for="f-${key}">${label}${required ? ' *' : ''}</label>
      ${options ? `<select id="f-${key}">${optionsHtml(options, value(key))}</select>` : (type === 'textarea' ? `<textarea id="f-${key}">${esc(value(key))}</textarea>` : `<input id="f-${key}" type="${type}" value="${esc(key === 'birth_date' ? formatDate(value(key)) : value(key))}" ${required ? 'required' : ''}>`)}
    </div>
  `;

  return `
    <div class="form-grid">
      <div class="span-3 photo-uploader">
        <div id="student-photo-preview">${student ? studentPhotoHtml({ ...student, photo_url: student.photo_url }, 'photo-preview') : '<span class="photo-preview photo-placeholder">暂无照片</span>'}</div>
        <div class="field">
          <span>学生照片</span>
          ${student ? `<button type="button" class="btn" id="upload-photo-btn">${icon('image-up')}上传照片</button>` : '<p class="form-error" style="min-height:0">保存后可上传照片</p>'}
        </div>
      </div>
      ${field('name', '姓名', 'text', null, 1, true)}
      ${field('student_no', '学号', 'text', null, 1, true)}
      ${field('id_card', '身份证号码', 'text', null, 1, true)}
      ${field('grade', '年级', 'text', null, 1)}
      ${field('school_years', '学制', 'text', null, 1)}
      ${field('major', '专业', 'text', null, 1)}
      ${field('class_name', '班级', 'text', null, 1, true)}
      ${field('political_status', '政治面貌', 'text', POLITICAL_STATUSES, 1)}
      ${field('gender', '性别', 'text', GENDERS, 1)}
      ${field('phone', '学生手机号', 'text', null, 1, true)}
      ${field('community', '所住社区', 'text', null, 1)}
      ${field('dorm_room', '所住寝室号', 'text', null, 1)}
      ${field('bed_no', '所住床位', 'text', null, 1)}
      ${field('birth_date', '出生日期', 'date', null, 1)}
      ${field('ethnicity', '民族', 'text', null, 1)}
      ${field('household_address', '户籍地址', 'text', null, 1)}
      ${field('current_address', '实际居住地址', 'text', null, 1)}
      ${field('father_name', '父亲姓名', 'text', null, 1)}
      ${field('father_phone', '父亲电话', 'text', null, 1)}
      ${field('mother_name', '母亲姓名', 'text', null, 1)}
      ${field('mother_phone', '母亲电话', 'text', null, 1)}
      ${field('emergency_name', '紧急备用联系人姓名', 'text', null, 1)}
      ${field('emergency_phone', '紧急备用联系人电话', 'text', null, 1)}
      ${field('talents', '个人特长', 'textarea', null, 2)}
      ${field('poverty_status', '贫困户标记', 'text', POVERTY_STATUSES, 1)}
      ${field('hardship_level', '困难认定等级', 'text', null, 1)}
      ${field('scholarship_level', '助学金等级', 'text', null, 1)}
      ${field('enrollment_status', '学籍状态', 'text', statuses.map((s) => s.label), 1)}
      ${field('counselor', '辅导员', 'text', null, 1)}
    </div>
  `;
}

function collectStudentForm() {
  const keys = ['name', 'student_no', 'id_card', 'grade', 'school_years', 'major', 'class_name', 'political_status', 'gender', 'phone', 'community', 'dorm_room', 'bed_no', 'birth_date', 'ethnicity', 'household_address', 'current_address', 'father_name', 'father_phone', 'mother_name', 'mother_phone', 'emergency_name', 'emergency_phone', 'talents', 'poverty_status', 'hardship_level', 'scholarship_level', 'enrollment_status', 'counselor'];
  const data = {};
  keys.forEach((key) => {
    const el = $(`#f-${key}`);
    data[key] = el ? el.value.trim() : '';
  });
  return data;
}

async function openStudentForm(studentId) {
  let student = null;
  if (studentId) {
    const detail = await api.students.getDetail(studentId);
    student = detail.student;
  }
  const statuses = await api.settings.statuses();
  openModal(modalShell(studentId ? '编辑学生' : '新增学生', studentFormHtml(student, statuses), `
    <button type="button" class="btn" data-close-modal>取消</button>
    <button type="button" class="btn btn-primary" id="save-student-btn">${icon('save')}保存</button>
  `, { wide: true }));

  $('#save-student-btn').addEventListener('click', async () => {
    try {
      const data = collectStudentForm();
      if (studentId) {
        data.id = studentId;
        await api.students.update(data);
      } else {
        await api.students.create(data);
      }
      closeModal();
      toast(studentId ? '学生信息已更新' : '学生已新增', 'success');
      state.studentsFilters.page = 1;
      renderStudentsPage();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  if (studentId) {
    $('#upload-photo-btn').addEventListener('click', async () => {
      try {
        const updated = await api.students.choosePhoto(studentId);
        $('#student-photo-preview').innerHTML = studentPhotoHtml({ ...updated, photo_url: updated.photo_url }, 'photo-preview');
        student = updated;
        toast('照片已更新', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

function detailSectionHtml(title, body) {
  return `<div class="detail-section"><h4>${esc(title)}</h4>${body}</div>`;
}

function copyStudentText(detail) {
  const s = detail.student;
  const profileKeys = [
    ['姓名', s.name], ['学号', s.student_no], ['身份证号码', s.id_card], ['年级', s.grade], ['学制', s.school_years],
    ['专业', s.major], ['班级', s.class_name], ['政治面貌', s.political_status], ['性别', s.gender], ['学生手机号', s.phone],
    ['所住社区', s.community], ['所住寝室号', s.dorm_room], ['所住床位', s.bed_no], ['出生日期', formatDate(s.birth_date)], ['民族', s.ethnicity],
    ['户籍地址', s.household_address], ['实际居住地址', s.current_address], ['父亲姓名', s.father_name], ['父亲电话', s.father_phone],
    ['母亲姓名', s.mother_name], ['母亲电话', s.mother_phone], ['紧急联系人姓名', s.emergency_name], ['紧急联系人电话', s.emergency_phone],
    ['个人特长', s.talents], ['贫困户标记', s.poverty_status], ['困难认定等级', s.hardship_level], ['助学金等级', s.scholarship_level],
    ['学籍状态', s.enrollment_status], ['辅导员', s.counselor]
  ];
  const lines = ['【学生档案】'];
  profileKeys.forEach(([k, v]) => {
    if (String(v ?? '').trim()) lines.push(`${k}：${v}`);
  });
  lines.push('', '【考勤记录】');
  (detail.attendance || []).forEach((r) => lines.push(`${r.semester} 第${r.week_no}周 ${r.start_period}-${r.end_period}节 ${r.attendance_type}${r.notes ? `（${r.notes}）` : ''}`));
  lines.push('', '【处分记录】');
  (detail.discipline || []).forEach((r) => lines.push(`${r.punishment_date} ${r.punishment_type}：${r.reason}（${r.status}${r.revoke_date ? `，撤销时间 ${r.revoke_date}` : ''}）`));
  lines.push('', '【奖励记录】');
  (detail.rewards || []).forEach((r) => lines.push(`${r.award_date} ${r.award_name}${r.issuer ? `（颁发单位：${r.issuer}）` : ''}${r.notes ? `（${r.notes}）` : ''}`));
  return lines.join('\n');
}

async function openStudentDetail(studentId) {
  const detail = await api.students.getDetail(studentId);
  const s = detail.student;
  const profileItems = [
    ['学号', s.student_no], ['身份证号码', s.id_card], ['年级', s.grade], ['学制', s.school_years], ['专业', s.major],
    ['班级', s.class_name], ['政治面貌', s.political_status], ['性别', s.gender], ['手机号', s.phone], ['所住社区', s.community],
    ['寝室号', s.dorm_room], ['床位', s.bed_no], ['出生日期', formatDate(s.birth_date)], ['民族', s.ethnicity], ['户籍地址', s.household_address],
    ['实际居住地址', s.current_address], ['父亲', s.father_name ? `${s.father_name} ${s.father_phone || ''}` : ''], ['母亲', s.mother_name ? `${s.mother_name} ${s.mother_phone || ''}` : ''],
    ['紧急联系人', s.emergency_name ? `${s.emergency_name} ${s.emergency_phone || ''}` : ''], ['个人特长', s.talents], ['贫困户标记', s.poverty_status],
    ['困难认定', s.hardship_level], ['助学金', s.scholarship_level], ['学籍状态', s.enrollment_status], ['辅导员', s.counselor]
  ].filter(([, v]) => String(v ?? '').trim());

  const gradeSummaryRows = (detail.grade_summaries || []).map((r) => `<tr><td>${esc(r.semester)}</td><td>${r.rank ?? ''}</td><td>${r.course_count ?? ''}</td><td>${r.failed_course_count ?? ''}</td><td>${r.credits_taken ?? ''}</td><td>${r.credits_earned ?? ''}</td><td>${r.gpa ?? ''}</td><td>${r.credit_gpa ?? ''}</td><td>${r.avg_gpa ?? ''}</td><td>${r.avg_score ?? ''}</td></tr>`).join('');
  const evalRows = (detail.evaluations || []).map((r) => `<tr><td>${esc(r.academic_year)}</td><td>${r.add_points}</td><td>${r.deduct_points}</td><td>${r.total_score}</td><td>${esc(r.notes)}</td></tr>`).join('');
  const attendanceRows = (detail.attendance || []).map((r) => `<tr><td>${esc(r.semester)}</td><td>第${r.week_no}周</td><td>${r.start_period}-${r.end_period}节</td><td>${esc(r.attendance_type)}</td><td>${r.period_count}</td></tr>`).join('');
  const disciplineRows = (detail.discipline || []).map((r) => `<tr><td>${esc(r.punishment_type)}</td><td>${esc(r.reason)}</td><td>${esc(r.punishment_date)}</td><td>${esc(r.status)}</td><td>${esc(r.revoke_date || '')}</td></tr>`).join('');
  const rewardRows = (detail.rewards || []).map((r) => `<tr><td>${esc(r.award_name)}</td><td>${esc(r.issuer || '')}</td><td>${esc(r.award_date)}</td><td>${esc(r.notes)}</td></tr>`).join('');

  const body = `
    <div class="detail-layout">
      <div class="detail-head">
        ${studentPhotoHtml({ ...s, photo_url: s.photo_url }, 'detail-photo')}
        <h4>${esc(s.name)}</h4>
        <div class="meta">${esc(s.class_name)}<br>${esc(s.student_no)}<br>${esc(s.enrollment_status || '学籍状态未设置')}</div>
        <button class="btn btn-primary" data-action="copy-student-detail" data-id="${s.id}">${icon('copy')}一键复制</button>
      </div>
      <div>
        <div class="detail-section">
          <h4>学生档案</h4>
          <div class="detail-grid">${profileItems.map(([k, v]) => `<div class="detail-item"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
        </div>
        ${detailSectionHtml('成绩汇总', gradeSummaryRows ? `<div class="table-wrap"><table><thead><tr><th>学期</th><th>名次</th><th>修读环节数</th><th>未通过环节数</th><th>修读学分</th><th>获得学分</th><th>绩点</th><th>学分绩点</th><th>平均绩点</th><th>平均成绩</th></tr></thead><tbody>${gradeSummaryRows}</tbody></table></div>` : '<div class="empty-state">暂无成绩汇总</div>')}
        ${detailSectionHtml('学年综测', evalRows ? `<div class="table-wrap"><table><thead><tr><th>学年</th><th>加分</th><th>减分</th><th>总得分</th><th>备注</th></tr></thead><tbody>${evalRows}</tbody></table></div>` : '<div class="empty-state">暂无综测记录</div>')}
        ${detailSectionHtml('考勤记录', attendanceRows ? `<div class="table-wrap"><table><thead><tr><th>学期</th><th>周次</th><th>节次</th><th>类型</th><th>学时</th></tr></thead><tbody>${attendanceRows}</tbody></table></div>` : '<div class="empty-state">暂无考勤记录</div>')}
        ${detailSectionHtml('处分记录', disciplineRows ? `<div class="table-wrap"><table><thead><tr><th>处分</th><th>原因</th><th>时间</th><th>状态</th><th>撤销时间</th></tr></thead><tbody>${disciplineRows}</tbody></table></div>` : '<div class="empty-state">暂无处分记录</div>')}
        ${detailSectionHtml('奖励记录', rewardRows ? `<div class="table-wrap"><table><thead><tr><th>奖项</th><th>颁发单位</th><th>时间</th><th>备注</th></tr></thead><tbody>${rewardRows}</tbody></table></div>` : '<div class="empty-state">暂无奖励记录</div>')}
      </div>
    </div>
  `;
  openModal(modalShell(`学生详情：${s.name}`, body, '', { wide: true }));
  $('#modal-root').addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action="copy-student-detail"]');
    if (!btn) return;
    try {
      await api.clipboard.writeText(copyStudentText(detail));
      toast('学生信息已复制到剪贴板', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderGradesPage() {
  const student = state.gradeStudent;
  let gradesHtml = '<div class="empty-state">请先在上方查找并选择学生</div>';
  let evalHtml = '<div class="empty-state">请先在上方查找并选择学生</div>';

  if (student) {
    const [grades, evaluations] = await Promise.all([
      api.grades.list(student.id),
      api.evaluations.list(student.id)
    ]);
    const gradeRows = grades.map((r) => `
      <tr>
        <td>${esc(r.semester)}</td><td>${esc(r.course_name)}</td><td>${r.score ?? ''}</td>
        <td>${r.is_failed ? '<span class="badge badge-red">是</span>' : '否'}</td>
        <td>${r.is_makeup ? '<span class="badge badge-amber">是</span>' : '否'}</td>
        <td>${r.is_retake ? '<span class="badge badge-blue">是</span>' : '否'}</td>
        <td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="grade-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="grade-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');
    const evalRows = evaluations.map((r) => `
      <tr><td>${esc(r.academic_year)}</td><td>${r.add_points}</td><td>${r.deduct_points}</td><td>${r.total_score}</td><td>${esc(r.notes)}</td>
      <td><button class="btn btn-sm" data-action="eval-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="eval-delete" data-id="${r.id}">删除</button></td></tr>`).join('');
    gradesHtml = gradeRows ? `<div class="table-wrap"><table><thead><tr><th>学期</th><th>课程</th><th>分数</th><th>挂科</th><th>补考后</th><th>重修后</th><th>备注</th><th>操作</th></tr></thead><tbody>${gradeRows}</tbody></table></div>` : '<div class="empty-state">暂无成绩记录</div>';
    evalHtml = evalRows ? `<div class="table-wrap"><table><thead><tr><th>学年</th><th>加分</th><th>减分</th><th>总得分</th><th>备注</th><th>操作</th></tr></thead><tbody>${evalRows}</tbody></table></div>` : '<div class="empty-state">暂无综测记录</div>';
  }

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>成绩与综测</h2><p>按学生维护每学期课程成绩和每学年综测结果。</p></div>
      <div class="page-actions">
        ${student ? `<button class="btn btn-primary" data-action="grade-add">${icon('plus')}新增成绩</button><button class="btn btn-primary" data-action="eval-add">${icon('plus')}新增综测</button>` : ''}
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>学生查询</span><input id="grade-student-keyword" placeholder="输入姓名 / 学号 / 身份证"></div>
      <button class="btn btn-primary" data-action="grade-find-student">${icon('search')}查找学生</button>
      ${student ? `<span class="badge badge-blue">当前学生：${esc(student.name)}（${esc(student.student_no)}）</span><button class="btn btn-sm" data-action="grade-clear-student">清除</button>` : ''}
    </div>
    <div id="grade-picker"></div>
    <div class="panel"><h3 class="panel-title">学期成绩 ${student ? '<span class="subtle">不包含在一键复制中</span>' : ''}</h3>${gradesHtml}</div>
    <div class="panel"><h3 class="panel-title">学年综测 ${student ? '<span class="subtle">不包含在一键复制中</span>' : ''}</h3>${evalHtml}</div>
  `;
}

async function findAndSelectStudent(keyword, target) {
  if (!keyword.trim()) {
    toast('请输入查询关键字', 'error');
    return null;
  }
  const result = await api.students.list({ keyword: keyword.trim(), keywordType: 'any', page: 1, pageSize: 20 });
  if (!result.items.length) {
    toast('未找到匹配学生', 'error');
    return null;
  }
  const picker = $('#grade-picker');
  if (picker) {
    picker.innerHTML = `<div class="panel"><div class="table-wrap"><table><thead><tr><th>姓名</th><th>学号</th><th>班级</th><th>操作</th></tr></thead><tbody>${result.items.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.student_no)}</td><td>${esc(s.class_name)}</td><td><button class="btn btn-sm btn-primary" data-action="pick-grade-student" data-id="${s.id}" data-name="${esc(s.name)}" data-no="${esc(s.student_no)}">选择</button></td></tr>`).join('')}</tbody></table></div></div>`;
  } else if (result.items.length === 1) {
    state.gradeStudent = result.items[0];
  } else {
    toast(`找到 ${result.items.length} 名学生，请在列表中选择`, '');
    return null;
  }
  return result.items.length === 1 ? result.items[0] : null;
}

function openGradeForm(record = null) {
  const student = state.gradeStudent;
  const body = `
    <div class="form-grid">
      <div class="field span-3"><span>学生</span><input value="${esc(student.name)}（${esc(student.student_no)}）" disabled></div>
      <div class="field"><span>学期</span><input id="g-semester" value="${esc(record ? record.semester : '')}" placeholder="如 2025-2026 第1学期"></div>
      <div class="field span-2"><span>课程名称</span><input id="g-course" value="${esc(record ? record.course_name : '')}"></div>
      <div class="field"><span>分数</span><input id="g-score" type="number" min="0" max="100" step="0.1" value="${record && record.score !== null ? record.score : ''}"></div>
      <label class="field"><span>是否挂科</span><select id="g-failed">${optionsHtml(['否', '是'], record && record.is_failed ? '是' : '否')}</select></label>
      <label class="field"><span>是否补考后成绩</span><select id="g-makeup">${optionsHtml(['否', '是'], record && record.is_makeup ? '是' : '否')}</select></label>
      <label class="field"><span>是否重修后成绩</span><select id="g-retake">${optionsHtml(['否', '是'], record && record.is_retake ? '是' : '否')}</select></label>
      <div class="field span-3"><span>备注</span><textarea id="g-notes">${esc(record ? record.notes : '')}</textarea></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑成绩' : '新增成绩', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-grade-btn">${icon('save')}保存</button>
  `));
  $('#save-grade-btn').addEventListener('click', async () => {
    try {
      const payload = {
        student_id: student.id,
        semester: $('#g-semester').value.trim(),
        course_name: $('#g-course').value.trim(),
        score: $('#g-score').value,
        is_failed: $('#g-failed').value === '是',
        is_makeup: $('#g-makeup').value === '是',
        is_retake: $('#g-retake').value === '是',
        notes: $('#g-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.grades.update(payload); else await api.grades.create(payload);
      closeModal();
      renderGradesPage();
      toast('成绩已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openEvalForm(record = null) {
  const student = state.gradeStudent;
  const body = `
    <div class="form-grid">
      <div class="field span-3"><span>学生</span><input value="${esc(student.name)}（${esc(student.student_no)}）" disabled></div>
      <div class="field span-3"><span>学年</span><input id="e-year" value="${esc(record ? record.academic_year : '')}" placeholder="如 2025-2026"></div>
      <div class="field"><span>加分</span><input id="e-add" type="number" step="0.01" value="${record ? record.add_points : ''}"></div>
      <div class="field"><span>减分</span><input id="e-deduct" type="number" step="0.01" value="${record ? record.deduct_points : ''}"></div>
      <div class="field"><span>总得分（留空自动按加分-减分）</span><input id="e-total" type="number" step="0.01" value="${record ? record.total_score : ''}"></div>
      <div class="field span-3"><span>备注</span><textarea id="e-notes">${esc(record ? record.notes : '')}</textarea></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑综测' : '新增综测', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-eval-btn">${icon('save')}保存</button>
  `));
  $('#save-eval-btn').addEventListener('click', async () => {
    try {
      const payload = {
        student_id: student.id,
        academic_year: $('#e-year').value.trim(),
        add_points: $('#e-add').value,
        deduct_points: $('#e-deduct').value,
        total_score: $('#e-total').value,
        notes: $('#e-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.evaluations.update(payload); else await api.evaluations.create(payload);
      closeModal();
      renderGradesPage();
      toast('综测已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderAttendancePage() {
  const student = state.attendanceStudent;
  const filters = { ...state.attendanceFilters };
  if (student) filters.student_id = student.id;
  const records = await api.attendance.list(filters);
  let statsHtml = '';
  if (student) {
    const stats = await api.attendance.stats(student.id, state.attendanceFilters.semester || '');
    statsHtml = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">旷课学时</div><div class="stat-value">${stats.absent_periods}</div></div>
        <div class="stat-card"><div class="stat-label">迟到次数</div><div class="stat-value">${stats.late_count}</div></div>
        <div class="stat-card"><div class="stat-label">早退次数</div><div class="stat-value">${stats.early_count}</div></div>
        <div class="stat-card"><div class="stat-label">折算旷课学时</div><div class="stat-value">${stats.equivalent_absent}</div><div class="stat-note">旷课 + (迟到+早退)÷3 向下取整</div></div>
      </div>
    `;
  }
  const rows = records.map((r) => `
    <tr>
      <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td><td>${esc(r.semester)}</td>
      <td>第${r.week_no}周</td><td>${r.start_period}-${r.end_period}节</td><td><span class="badge ${r.attendance_type === '旷课' ? 'badge-red' : 'badge-amber'}">${esc(r.attendance_type)}</span></td>
      <td>${r.period_count}</td><td>${esc(r.notes)}</td>
      <td><button class="btn btn-sm" data-action="attendance-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="attendance-delete" data-id="${r.id}">删除</button></td>
    </tr>`).join('');

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>考勤管理</h2><p>记录每学期、每周、每节课的旷课、迟到、早退情况。</p></div>
      <div class="page-actions">
        <button class="btn btn-primary" data-action="attendance-add">${icon('plus')}新增考勤</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>学生查询</span><input id="attendance-keyword" value="${esc(state.attendanceFilters.keyword)}" placeholder="输入姓名 / 学号 / 身份证"></div>
      <div class="field"><span>学期</span><input id="attendance-semester" value="${esc(state.attendanceFilters.semester)}" placeholder="如 2025-2026 第1学期"></div>
      <button class="btn btn-primary" data-action="attendance-search">${icon('search')}查询</button>
      <button class="btn" data-action="attendance-clear">${icon('rotate-ccw')}清空</button>
      ${student ? `<span class="badge badge-blue">当前学生：${esc(student.name)}（${esc(student.student_no)}）</span>` : ''}
    </div>
    ${statsHtml}
    <div class="panel">
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>学号</th><th>班级</th><th>学期</th><th>周次</th><th>节次</th><th>类型</th><th>学时</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10"><div class="empty-state">暂无考勤记录</div></td></tr>'}</tbody>
      </table></div>
    </div>
  `;
}

function openAttendanceForm(record = null) {
  const student = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : state.attendanceStudent;
  if (!student) {
    toast('请先选择学生', 'error');
    return;
  }
  const body = `
    <div class="form-grid">
      <div class="field span-3"><span>学生</span><input value="${esc(student.name)}（${esc(student.student_no)}）" disabled></div>
      <div class="field"><span>学期</span><input id="a-semester" value="${esc(record ? record.semester : '')}" placeholder="如 2025-2026 第1学期"></div>
      <div class="field"><span>周次</span><input id="a-week" type="number" min="1" value="${record ? record.week_no : ''}"></div>
      <div class="field"><span>类型</span><select id="a-type">${optionsHtml(['旷课', '迟到', '早退'], record ? record.attendance_type : '旷课')}</select></div>
      <div class="field"><span>开始节次</span><input id="a-start" type="number" min="1" value="${record ? record.start_period : ''}"></div>
      <div class="field"><span>结束节次</span><input id="a-end" type="number" min="1" value="${record ? record.end_period : ''}"></div>
      <div class="field"><span>备注</span><input id="a-notes" value="${esc(record ? record.notes : '')}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑考勤' : '新增考勤', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-attendance-btn">${icon('save')}保存</button>
  `));
  $('#save-attendance-btn').addEventListener('click', async () => {
    try {
      const payload = {
        student_id: student.id,
        semester: $('#a-semester').value.trim(),
        week_no: $('#a-week').value,
        start_period: $('#a-start').value,
        end_period: $('#a-end').value,
        attendance_type: $('#a-type').value,
        notes: $('#a-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.attendance.update(payload); else await api.attendance.create(payload);
      closeModal();
      renderAttendancePage();
      toast('考勤已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function renderRecordPage(type) {
  const isDiscipline = type === 'discipline';
  const student = isDiscipline ? state.disciplineStudent : state.rewardStudent;
  const filters = { ...(isDiscipline ? state.disciplineFilters : state.rewardFilters) };
  if (student) filters.student_id = student.id;
  else delete filters.student_id;
  return api[isDiscipline ? 'discipline' : 'rewards'].list(filters).then((records) => {
    const rows = records.map((r) => isDiscipline ? `
      <tr>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td><span class="badge badge-red">${esc(r.punishment_type)}</span></td><td>${esc(r.reason)}</td><td>${esc(r.punishment_date)}</td>
        <td>${esc(r.status)}</td><td>${esc(r.revoke_date || '')}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="${type}-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="${type}-delete" data-id="${r.id}">删除</button></td>
      </tr>` : `
      <tr>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td>${esc(r.activity)}</td><td><span class="badge badge-green">${esc(r.award_name)}</span></td><td>${esc(r.award_date)}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="${type}-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="${type}-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');

    $('#content').innerHTML = `
      <div class="page-head">
        <div><h2>${isDiscipline ? '处分记录' : '奖励记录'}</h2><p>${isDiscipline ? '记录学生处分原因、类型、状态与撤销时间。' : '记录学生参加活动获得的奖项与时间。'}</p></div>
        <div class="page-actions"><button class="btn btn-primary" data-action="${type}-add">${icon('plus')}新增${isDiscipline ? '处分' : '奖励'}</button></div>
      </div>
      <div class="toolbar">
        <div class="field"><span>学生查询</span><input id="${type}-keyword" value="${esc(filters.keyword)}" placeholder="输入姓名 / 学号 / 身份证"></div>
        <button class="btn btn-primary" data-action="${type}-search">${icon('search')}查询</button>
        <button class="btn" data-action="${type}-clear">${icon('rotate-ccw')}清空</button>
        ${student ? `<span class="badge badge-blue">当前学生：${esc(student.name)}（${esc(student.student_no)}）</span>` : ''}
      </div>
      <div class="panel">
        <div class="table-wrap"><table>
          <thead>${isDiscipline ? '<tr><th>姓名</th><th>学号</th><th>班级</th><th>处分</th><th>原因</th><th>时间</th><th>状态</th><th>撤销时间</th><th>备注</th><th>操作</th></tr>' : '<tr><th>姓名</th><th>学号</th><th>班级</th><th>活动</th><th>奖项</th><th>时间</th><th>备注</th><th>操作</th></tr>'}</thead>
          <tbody>${rows || `<tr><td colspan="${isDiscipline ? 10 : 8}"><div class="empty-state">暂无记录</div></td></tr>`}</tbody>
        </table></div>
      </div>
    `;
  });
}

async function renderDisciplinePage() {
  await renderRecordPage('discipline');
}

async function renderRewardsPage() {
  await renderRecordPage('rewards');
}

function openDisciplineForm(record = null) {
  const student = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : state.disciplineStudent;
  if (!student) {
    toast('请先选择学生', 'error');
    return;
  }
  const body = `
    <div class="form-grid">
      <div class="field span-3"><span>学生</span><input value="${esc(student.name)}（${esc(student.student_no)}）" disabled></div>
      <div class="field span-3"><span>处分原因</span><textarea id="d-reason">${esc(record ? record.reason : '')}</textarea></div>
      <div class="field"><span>处分类型</span><select id="d-type">${optionsHtml(DISCIPLINE_TYPES, record ? record.punishment_type : '')}</select></div>
      <div class="field"><span>处分时间</span><input id="d-date" type="date" value="${esc(record ? record.punishment_date : '')}"></div>
      <div class="field"><span>当前状态</span><select id="d-status">${optionsHtml(DISCIPLINE_STATUSES, record ? record.status : '处分中')}</select></div>
      <div class="field"><span>撤销时间</span><input id="d-revoke" type="date" value="${esc(record ? record.revoke_date || '' : '')}"></div>
      <div class="field span-2"><span>备注</span><input id="d-notes" value="${esc(record ? record.notes : '')}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑处分' : '新增处分', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-discipline-btn">${icon('save')}保存</button>
  `));
  $('#save-discipline-btn').addEventListener('click', async () => {
    try {
      const payload = {
        student_id: student.id,
        reason: $('#d-reason').value.trim(),
        punishment_type: $('#d-type').value,
        punishment_date: $('#d-date').value,
        status: $('#d-status').value,
        revoke_date: $('#d-revoke').value,
        notes: $('#d-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.discipline.update(payload); else await api.discipline.create(payload);
      closeModal();
      renderDisciplinePage();
      toast('处分记录已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openRewardForm(record = null) {
  const student = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : state.rewardStudent;
  if (!student) {
    toast('请先选择学生', 'error');
    return;
  }
  const body = `
    <div class="form-grid">
      <div class="field span-3"><span>学生</span><input value="${esc(student.name)}（${esc(student.student_no)}）" disabled></div>
      <div class="field span-2"><span>活动名称</span><input id="r-activity" value="${esc(record ? record.activity : '')}"></div>
      <div class="field"><span>获奖时间</span><input id="r-date" type="date" value="${esc(record ? record.award_date : '')}"></div>
      <div class="field span-2"><span>奖项名称（可手动输入）</span><input id="r-award" value="${esc(record ? record.award_name : '')}"></div>
      <div class="field"><span>备注</span><input id="r-notes" value="${esc(record ? record.notes : '')}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑奖励' : '新增奖励', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-reward-btn">${icon('save')}保存</button>
  `));
  $('#save-reward-btn').addEventListener('click', async () => {
    try {
      const payload = {
        student_id: student.id,
        activity: $('#r-activity').value.trim(),
        award_name: $('#r-award').value.trim(),
        award_date: $('#r-date').value,
        notes: $('#r-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.rewards.update(payload); else await api.rewards.create(payload);
      closeModal();
      renderRewardsPage();
      toast('奖励记录已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderLogsPage() {
  const filters = state.logFilters;
  const result = await api.logs.list(filters);
  const rows = result.items.map((log) => `
    <tr>
      <td>${esc(log.created_at)}</td><td>${esc(log.username || 'system')}</td><td>${esc(log.module)}</td>
      <td><span class="badge badge-blue">${esc(log.action)}</span></td><td>${esc(log.detail || '')}</td>
    </tr>`).join('');
  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>操作日志</h2><p>自动记录登录、增删改、导入导出与设置变更。</p></div>
    </div>
    <div class="toolbar">
      <div class="field"><span>关键字</span><input id="log-keyword" value="${esc(filters.keyword)}" placeholder="用户 / 动作 / 详情"></div>
      <button class="btn btn-primary" data-action="logs-query">${icon('search')}查询</button>
      <button class="btn" data-action="logs-reset">${icon('rotate-ccw')}重置</button>
    </div>
    <div class="panel">
      <div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>用户</th><th>模块</th><th>动作</th><th>详情</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5"><div class="empty-state">暂无日志</div></td></tr>'}</tbody>
      </table></div>
      ${paginationHtml(result.total, result.page, result.pageSize, 'logs')}
    </div>
  `;
}

function openUserForm(user = null) {
  const body = `
    <div class="form-grid">
      <div class="field"><span>用户名</span><input id="u-username" value="${esc(user ? user.username : '')}" ${user ? 'disabled' : ''}></div>
      <div class="field"><span>显示名称</span><input id="u-display" value="${esc(user ? user.display_name : '')}"></div>
      <div class="field"><span>${user ? '新密码（留空不修改）' : '密码（至少6位）'}</span><input id="u-password" type="password"></div>
      <div class="field"><span>启用状态</span><select id="u-active">${optionsHtml(['启用', '停用'], user && !user.is_active ? '停用' : '启用')}</select></div>
    </div>
  `;
  openModal(modalShell(user ? '编辑账号' : '新增账号', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-user-btn">${icon('save')}保存</button>
  `, { narrow: true }));
  $('#save-user-btn').addEventListener('click', async () => {
    try {
      const payload = {
        username: $('#u-username').value.trim(),
        display_name: $('#u-display').value.trim(),
        password: $('#u-password').value,
        is_active: $('#u-active').value === '启用'
      };
      if (user) { payload.id = user.id; await api.users.update(payload); }
      else await api.users.create(payload);
      closeModal();
      renderSettingsPage();
      toast('账号已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openStatusForm(status = null) {
  const body = `
    <div class="form-grid">
      <div class="field span-2"><span>状态名称</span><input id="s-label" value="${esc(status ? status.label : '')}"></div>
      <div class="field"><span>排序</span><input id="s-order" type="number" min="0" value="${status ? status.sort_order : ''}"></div>
      <div class="field span-3"><span>是否计入总人数</span><select id="s-counts">${optionsHtml(['否', '是'], status && status.counts_to_total ? '是' : '否')}</select></div>
    </div>
  `;
  openModal(modalShell(status ? '编辑学籍状态' : '新增学籍状态', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-status-btn">${icon('save')}保存</button>
  `, { narrow: true }));
  $('#save-status-btn').addEventListener('click', async () => {
    try {
      const payload = {
        label: $('#s-label').value.trim(),
        sort_order: $('#s-order').value,
        counts_to_total: $('#s-counts').value === '是'
      };
      if (status) { payload.id = status.id; await api.settings.updateStatus(payload); }
      else await api.settings.createStatus(payload);
      closeModal();
      renderSettingsPage();
      toast('学籍状态已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function changePasswordModal() {
  openModal(modalShell('修改密码', `
    <div class="form-grid">
      <div class="field span-3"><span>原密码</span><input id="cp-old" type="password"></div>
      <div class="field span-3"><span>新密码（至少6位）</span><input id="cp-new" type="password"></div>
    </div>
  `, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-cp-btn">${icon('save')}保存</button>
  `, { narrow: true }));
  $('#save-cp-btn').addEventListener('click', async () => {
    try {
      await api.auth.changePassword($('#cp-old').value, $('#cp-new').value);
      closeModal();
      toast('密码已修改', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderSettingsPage() {
  const [users, statuses] = await Promise.all([api.users.list(), api.settings.statuses()]);
  const userRows = users.map((u) => `
    <tr>
      <td>${esc(u.username)}</td><td>${esc(u.display_name)}</td><td><span class="badge ${u.is_active ? 'badge-green' : 'badge-red'}">${u.is_active ? '启用' : '停用'}</span></td>
      <td>${esc(u.created_at)}</td><td>${esc(u.last_login_at || '')}</td>
      <td><button class="btn btn-sm" data-action="user-edit" data-id="${u.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="user-delete" data-id="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>删除</button></td>
    </tr>`).join('');
  const statusRows = statuses.map((s) => `
    <tr>
      <td>${esc(s.label)}</td><td>${s.sort_order}</td><td>${s.counts_to_total ? '<span class="badge badge-green">计入总人数</span>' : '<span class="badge">不计入</span>'}</td>
      <td><button class="btn btn-sm" data-action="status-edit" data-id="${s.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="status-delete" data-id="${s.id}">删除</button></td>
    </tr>`).join('');
  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>账号与设置</h2><p>管理登录账号和学籍状态统计口径。</p></div>
      <div class="page-actions"><button class="btn" data-action="change-password">${icon('key-round')}修改密码</button></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">登录账号 <span class="subtle">所有账号业务权限相同</span><button class="btn btn-sm btn-primary" data-action="user-add">${icon('user-plus')}新增账号</button></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>用户名</th><th>显示名称</th><th>状态</th><th>创建时间</th><th>最近登录</th><th>操作</th></tr></thead>
        <tbody>${userRows || '<tr><td colspan="6"><div class="empty-state">暂无账号</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">学籍状态 <span class="subtle">首页总人数统计勾选“计入总人数”的状态</span><button class="btn btn-sm btn-primary" data-action="status-add">${icon('plus')}新增状态</button></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>状态名称</th><th>排序</th><th>总人数统计</th><th>操作</th></tr></thead>
        <tbody>${statusRows || '<tr><td colspan="4"><div class="empty-state">暂无状态</div></td></tr>'}</tbody>
      </table></div>
    </div>
  `;
}

function bindContentClick() {
  $('#content').addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    try {
      switch (action) {
        case 'refresh-dashboard': renderDashboard(); break;

        case 'student-add': openStudentForm(); break;
        case 'student-view': openStudentDetail(Number(btn.dataset.id)); break;
        case 'student-edit': openStudentForm(Number(btn.dataset.id)); break;
        case 'student-delete': {
          if (await confirmDialog('删除学生', '确认删除该学生？相关成绩、综测、考勤、处分、奖励记录会一并删除。')) {
            await api.students.remove(Number(btn.dataset.id));
            state.selectedStudentIds.delete(Number(btn.dataset.id));
            toast('学生已删除', 'success');
            renderStudentsPage();
          }
          break;
        }
        case 'students-batch-delete': {
          const count = Math.max(1, state.batchDeleteCount || 20);
          const selected = [...state.selectedStudentIds];
          let ids = [];
          let label = '';
          if (selected.length) {
            ids = selected.slice(0, count);
            label = `已勾选学生中的前 ${ids.length} 条`;
          } else {
            const result = await api.students.list({ ...state.studentsFilters, page: 1, pageSize: count });
            ids = result.items.map((s) => s.id);
            label = `当前筛选结果中的前 ${ids.length} 条`;
          }
          if (!ids.length) {
            toast('没有可删除的学生', 'error');
            break;
          }
          if (await confirmDialog('批量删除学生', `将删除${label}及其全部关联记录，确认？`)) {
            await api.students.batchRemove(ids);
            ids.forEach((id) => state.selectedStudentIds.delete(id));
            toast(`已批量删除 ${ids.length} 名学生`, 'success');
            renderStudentsPage();
          }
          break;
        }
        case 'students-query':
          state.studentsFilters.keyword = $('#filter-keyword').value.trim();
          state.studentsFilters.keywordType = $('#filter-keyword-type').value;
          state.studentsFilters.className = $('#filter-class').value;
          state.studentsFilters.enrollmentStatus = $('#filter-status').value;
          state.studentsFilters.archived = $('#filter-archived').value;
          state.studentsFilters.page = 1;
          renderStudentsPage();
          break;
        case 'students-reset':
          state.studentsFilters = { keyword: '', keywordType: 'any', className: '', enrollmentStatus: '', archived: '0', page: 1, pageSize: 20 };
          renderStudentsPage();
          break;
        case 'student-archive': {
          if (await confirmDialog('归档学生', '确认归档该学生？归档后不再参与展示和统计。')) {
            await api.students.archive([Number(btn.dataset.id)], true);
            state.selectedStudentIds.delete(Number(btn.dataset.id));
            toast('学生已归档', 'success');
            renderStudentsPage();
          }
          break;
        }
        case 'student-restore': {
          await api.students.archive([Number(btn.dataset.id)], false);
          toast('学生已恢复', 'success');
          renderStudentsPage();
          break;
        }
        case 'students-batch-archive':
        case 'students-batch-restore': {
          const archived = action === 'students-batch-archive';
          const count = Math.max(1, state.batchDeleteCount || 20);
          const selected = [...state.selectedStudentIds];
          let ids = [];
          let label = '';
          if (selected.length) {
            ids = selected.slice(0, count);
            label = `已勾选学生中的前 ${ids.length} 条`;
          } else {
            const result = await api.students.list({ ...state.studentsFilters, page: 1, pageSize: count });
            ids = result.items.map((s) => s.id);
            label = `当前筛选结果中的前 ${ids.length} 条`;
          }
          if (!ids.length) {
            toast('没有可处理的学生', 'error');
            break;
          }
          if (await confirmDialog(archived ? '批量归档学生' : '批量恢复学生', `将${archived ? '归档' : '恢复'}${label}，确认？`)) {
            await api.students.archive(ids, archived);
            ids.forEach((id) => state.selectedStudentIds.delete(id));
            toast(`已${archived ? '归档' : '恢复'} ${ids.length} 名学生`, 'success');
            renderStudentsPage();
          }
          break;
        }
        case 'students-page':
          state.studentsFilters.page = Math.max(1, Number(btn.dataset.page));
          renderStudentsPage();
          break;
        case 'excel-template': {
          const file = await api.excel.downloadTemplate();
          if (file) toast(`模板已保存：${file}`, 'success');
          break;
        }
        case 'excel-import': {
          const report = await api.excel.import();
          if (report) {
            openModal(modalShell('导入结果', `
              <div class="stat-grid">
                <div class="stat-card"><div class="stat-label">成功导入</div><div class="stat-value">${report.imported.length}</div></div>
                <div class="stat-card"><div class="stat-label">跳过</div><div class="stat-value">${report.skipped.length}</div></div>
              </div>
              ${report.skipped.length ? `<div class="table-wrap"><table><thead><tr><th>Excel行</th><th>学号</th><th>姓名</th><th>原因</th></tr></thead><tbody>${report.skipped.map((s) => `<tr><td>${s.line}</td><td>${esc(s.student_no)}</td><td>${esc(s.name)}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">没有跳过行</div>'}
            `, `<button class="btn btn-primary" data-close-modal>完成</button>`));
            renderStudentsPage();
          }
          break;
        }
        case 'excel-export': {
          const studentIds = state.selectedStudentIds.size ? [...state.selectedStudentIds] : [];
          const file = await api.excel.export(studentIds.length ? { studentIds } : state.studentsFilters);
          if (file) toast(`已导出：${file}`, 'success');
          break;
        }

        case 'grade-find-student': {
          state.gradeStudent = await findAndSelectStudent($('#grade-student-keyword').value, 'grade');
          renderGradesPage();
          break;
        }
        case 'pick-grade-student':
          state.gradeStudent = { id: Number(btn.dataset.id), name: btn.dataset.name, student_no: btn.dataset.no };
          renderGradesPage();
          break;
        case 'grade-clear-student':
          state.gradeStudent = null;
          renderGradesPage();
          break;
        case 'grade-add': openGradeForm(); break;
        case 'grade-edit': {
          openGradeForm(await api.grades.get(Number(btn.dataset.id)));
          break;
        }
        case 'grade-delete': {
          if (await confirmDialog('删除成绩', '确认删除该成绩记录？')) {
            await api.grades.remove(Number(btn.dataset.id));
            renderGradesPage();
          }
          break;
        }
        case 'eval-add': openEvalForm(); break;
        case 'eval-edit': {
          openEvalForm(await api.evaluations.get(Number(btn.dataset.id)));
          break;
        }
        case 'eval-delete': {
          if (await confirmDialog('删除综测', '确认删除该综测记录？')) {
            await api.evaluations.remove(Number(btn.dataset.id));
            renderGradesPage();
          }
          break;
        }

        case 'grades-query':
          state.gradesFilters.keyword = $('#grades-keyword').value.trim();
          state.gradesFilters.semester = $('#grades-semester').value.trim();
          state.gradesFilters.academicYear = $('#grades-year').value.trim();
          renderGradesPage();
          break;
        case 'grades-reset':
          state.gradesFilters = { keyword: '', semester: '', academicYear: '' };
          renderGradesPage();
          break;
        case 'toggle-semester': {
          const body = btn.nextElementSibling;
          if (body) body.classList.toggle('hidden');
          const chevron = btn.querySelector('[data-lucide="chevron-right"]');
          if (chevron) chevron.style.transform = body.classList.contains('hidden') ? '' : 'rotate(90deg)';
          break;
        }
        case 'grade-summary-export': {
          const file = await api.grades.exportSummaries(state.gradesFilters);
          if (file) toast(`已导出：${file}`, 'success');
          break;
        }
        case 'eval-export': {
          const file = await api.evaluations.export(state.gradesFilters);
          if (file) toast(`已导出：${file}`, 'success');
          break;
        }
        case 'grade-summary-template': {
          const file = await api.excel.downloadGradeSummaryTemplate();
          if (file) toast(`模板已保存：${file}`, 'success');
          break;
        }
        case 'grade-summary-import': openGradeImportDialog(); break;
        case 'grade-summary-add': openGradeSummaryForm(); break;
        case 'grade-summary-edit': {
          openGradeSummaryForm(await api.grades.getSummary(Number(btn.dataset.id)));
          break;
        }
        case 'grade-summary-delete': {
          if (await confirmDialog('删除成绩汇总', '确认删除该成绩汇总记录？')) {
            await api.grades.removeSummary(Number(btn.dataset.id));
            renderGradesPage();
          }
          break;
        }
        case 'eval-template': {
          const file = await api.excel.downloadEvaluationTemplate();
          if (file) toast(`模板已保存：${file}`, 'success');
          break;
        }
        case 'eval-import': openEvalImportDialog(); break;

        case 'attendance-search': {
          const keyword = $('#attendance-keyword').value.trim();
          state.selectedAttendanceIds.clear();
          state.attendanceFilters.keyword = keyword;
          state.attendanceFilters.semester = $('#attendance-semester').value.trim();
          if (keyword) {
            const result = await api.students.list({ keyword, keywordType: 'any', page: 1, pageSize: 20 });
            if (result.items.length === 1) state.attendanceStudent = result.items[0];
            else if (result.items.length > 1) {
              state.attendanceStudent = null;
              toast(`找到 ${result.items.length} 名学生，请在列表中精确查询`, '');
            } else state.attendanceStudent = null;
          } else state.attendanceStudent = null;
          renderAttendancePage();
          break;
        }
        case 'attendance-clear':
          state.attendanceFilters = { keyword: '', semester: '' };
          state.attendanceStudent = null;
          state.selectedAttendanceIds.clear();
          renderAttendancePage();
          break;
        case 'attendance-template': {
          const file = await api.excel.downloadAttendanceTemplate();
          if (file) toast(`模板已保存：${file}`, 'success');
          break;
        }
        case 'attendance-import': openAttendanceImportDialog(); break;
        case 'attendance-export': {
          const file = await api.attendance.export(state.attendanceFilters);
          if (file) toast(`已导出：${file}`, 'success');
          break;
        }
        case 'attendance-batch-delete': {
          const ids = [...state.selectedAttendanceIds];
          if (!ids.length) {
            toast('请先勾选考勤记录', 'error');
            break;
          }
          if (await confirmDialog('批量删除考勤', `确认删除选中的 ${ids.length} 条考勤记录？`)) {
            await api.attendance.batchRemove(ids);
            ids.forEach((id) => state.selectedAttendanceIds.delete(id));
            toast(`已批量删除 ${ids.length} 条考勤记录`, 'success');
            renderAttendancePage();
          }
          break;
        }
        case 'attendance-add': openAttendanceForm(); break;
        case 'attendance-edit': {
          const record = await api.attendance.get(Number(btn.dataset.id));
          if (record) {
            state.attendanceStudent = { id: record.student_id, name: record.student_name, student_no: record.student_no };
            openAttendanceForm(record);
          }
          break;
        }
        case 'attendance-delete': {
          if (await confirmDialog('删除考勤', '确认删除该考勤记录？')) {
            await api.attendance.remove(Number(btn.dataset.id));
            renderAttendancePage();
          }
          break;
        }

        case 'discipline-search':
        case 'rewards-search': {
          const type = action === 'discipline-search' ? 'discipline' : 'rewards';
          const keyword = $(`#${type}-keyword`).value.trim();
          if (type === 'discipline') {
            state.disciplineFilters.keyword = keyword;
            state.disciplineFilters.punishmentType = $('#discipline-type').value;
            state.disciplineFilters.status = $('#discipline-status').value;
          } else {
            state.rewardFilters.keyword = keyword;
            state.rewardFilters.awardName = $('#reward-award').value.trim();
          }
          if (keyword) {
            const result = await api.students.list({ keyword, keywordType: 'any', page: 1, pageSize: 20 });
            if (result.items.length === 1) {
              if (type === 'discipline') state.disciplineStudent = result.items[0]; else state.rewardStudent = result.items[0];
            } else if (result.items.length > 1) {
              if (type === 'discipline') state.disciplineStudent = null; else state.rewardStudent = null;
              toast(`找到 ${result.items.length} 名学生，请精确查询`, '');
            } else {
              if (type === 'discipline') state.disciplineStudent = null; else state.rewardStudent = null;
            }
          } else {
            if (type === 'discipline') state.disciplineStudent = null; else state.rewardStudent = null;
          }
          renderRecordPage(type);
          break;
        }
        case 'discipline-clear':
        case 'rewards-clear': {
          const type = action === 'discipline-clear' ? 'discipline' : 'rewards';
          if (type === 'discipline') { state.disciplineFilters = { keyword: '', punishmentType: '', status: '' }; state.disciplineStudent = null; }
          else { state.rewardFilters = { keyword: '', awardName: '' }; state.rewardStudent = null; }
          renderRecordPage(type);
          break;
        }
        case 'discipline-template': {
          const file = await api.excel.downloadDisciplineTemplate();
          if (file) toast(`模板已保存：${file}`, 'success');
          break;
        }
        case 'discipline-import': {
          const report = await api.discipline.import();
          if (report) {
            showImportReport(report);
            renderDisciplinePage();
          }
          break;
        }
        case 'discipline-export': {
          const file = await api.discipline.export(state.disciplineFilters);
          if (file) toast(`已导出：${file}`, 'success');
          break;
        }
        case 'rewards-template': {
          const file = await api.excel.downloadRewardTemplate();
          if (file) toast(`模板已保存：${file}`, 'success');
          break;
        }
        case 'rewards-import': {
          const report = await api.rewards.import();
          if (report) {
            showImportReport(report);
            renderRewardsPage();
          }
          break;
        }
        case 'rewards-export': {
          const file = await api.rewards.export(state.rewardFilters);
          if (file) toast(`已导出：${file}`, 'success');
          break;
        }
        case 'discipline-add': openDisciplineForm(); break;
        case 'discipline-edit': {
          const record = await api.discipline.get(Number(btn.dataset.id));
          if (record) {
            state.disciplineStudent = { id: record.student_id, name: record.student_name, student_no: record.student_no };
            openDisciplineForm(record);
          }
          break;
        }
        case 'discipline-delete': {
          if (await confirmDialog('删除处分', '确认删除该处分记录？')) {
            await api.discipline.remove(Number(btn.dataset.id));
            renderDisciplinePage();
          }
          break;
        }
        case 'rewards-add': openRewardForm(); break;
        case 'rewards-edit': {
          const record = await api.rewards.get(Number(btn.dataset.id));
          if (record) {
            state.rewardStudent = { id: record.student_id, name: record.student_name, student_no: record.student_no };
            openRewardForm(record);
          }
          break;
        }
        case 'rewards-delete': {
          if (await confirmDialog('删除奖励', '确认删除该奖励记录？')) {
            await api.rewards.remove(Number(btn.dataset.id));
            renderRewardsPage();
          }
          break;
        }

        case 'logs-query':
          state.logFilters.keyword = $('#log-keyword').value.trim();
          state.logFilters.page = 1;
          renderLogsPage();
          break;
        case 'logs-reset':
          state.logFilters = { keyword: '', page: 1, pageSize: 30 };
          renderLogsPage();
          break;
        case 'logs-page':
          state.logFilters.page = Math.max(1, Number(btn.dataset.page));
          renderLogsPage();
          break;

        case 'user-add': openUserForm(); break;
        case 'user-edit': {
          const users = await api.users.list();
          openUserForm(users.find((u) => u.id === Number(btn.dataset.id)));
          break;
        }
        case 'user-delete': {
          if (await confirmDialog('删除账号', '确认删除该账号？')) {
            await api.users.remove(Number(btn.dataset.id));
            renderSettingsPage();
          }
          break;
        }
        case 'status-add': openStatusForm(); break;
        case 'status-edit': {
          const statuses = await api.settings.statuses();
          openStatusForm(statuses.find((s) => s.id === Number(btn.dataset.id)));
          break;
        }
        case 'status-delete': {
          if (await confirmDialog('删除学籍状态', '确认删除该状态？')) {
            await api.settings.removeStatus(Number(btn.dataset.id));
            renderSettingsPage();
          }
          break;
        }
        case 'change-password': changePasswordModal(); break;
        default: break;
      }
    } catch (err) {
      toast(err.message || '操作失败', 'error');
    }
  });
}

function bindContentChange() {
  $('#content').addEventListener('change', (event) => {
    if (event.target.id === 'student-check-all') {
      document.querySelectorAll('.student-check').forEach((box) => {
        box.checked = event.target.checked;
        const id = Number(box.dataset.id);
        if (event.target.checked) state.selectedStudentIds.add(id);
        else state.selectedStudentIds.delete(id);
      });
    } else if (event.target.classList.contains('student-check')) {
      const id = Number(event.target.dataset.id);
      if (event.target.checked) state.selectedStudentIds.add(id);
      else state.selectedStudentIds.delete(id);
    } else if (event.target.classList.contains('attendance-check')) {
      const id = Number(event.target.dataset.id);
      if (event.target.checked) state.selectedAttendanceIds.add(id);
      else state.selectedAttendanceIds.delete(id);
    } else if (event.target.classList.contains('attendance-check-all')) {
      const group = event.target.closest('.semester-group');
      group.querySelectorAll('.attendance-check').forEach((box) => {
        box.checked = event.target.checked;
        const id = Number(box.dataset.id);
        if (event.target.checked) state.selectedAttendanceIds.add(id);
        else state.selectedAttendanceIds.delete(id);
      });
    } else if (event.target.id === 'page-size-select') {
      const value = Number(event.target.value);
      if (value >= 1 && value <= 500) {
        state.studentsFilters.pageSize = value;
        state.studentsFilters.page = 1;
        renderStudentsPage();
      }
    } else if (event.target.id === 'batch-delete-count') {
      const value = Number(event.target.value);
      if (value >= 1 && value <= 500) state.batchDeleteCount = value;
    }
  });
}

function bindGlobalEvents() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = $('#login-submit');
    submitBtn.disabled = true;
    try {
      const username = $('#login-username').value.trim();
      const password = $('#login-password').value;
      state.user = await api.auth.login(username, password);
      if ($('#login-remember').checked) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username, password }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
      $('#login-error').textContent = '';
      showMain();
    } catch (err) {
      $('#login-error').textContent = err.message || '登录失败';
    } finally {
      submitBtn.disabled = false;
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    try {
      await api.auth.logout();
    } catch {
      // 会话失效时也回到登录页
    }
    state.user = null;
    state.gradeStudent = null;
    state.attendanceStudent = null;
    state.disciplineStudent = null;
    state.rewardStudent = null;
    showLogin();
  });

  $('#modal-root').addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal]')) closeModal();
  });

  bindContentClick();
  bindContentChange();
}

async function init() {
  bindGlobalEvents();
  try {
    state.user = await api.auth.current();
    showMain();
  } catch {
    showLogin();
  }
}

async function renderGradesPage() {
  const filters = state.gradesKeyword ? { keyword: state.gradesKeyword } : {};
  const [summaries, courseGrades, evaluations] = await Promise.all([
    api.grades.listSummaries(filters),
    api.grades.listAll(filters),
    api.evaluations.listAll(filters)
  ]);
  const summaryRows = summaries.map((r) => `
    <tr>
      <td>${esc(r.semester)}</td><td>${esc(r.student_no)}</td><td>${esc(r.student_name)}</td>
      <td>${r.rank ?? ''}</td><td>${r.course_count ?? ''}</td><td>${r.failed_course_count ?? ''}</td>
      <td>${r.credits_taken ?? ''}</td><td>${r.credits_earned ?? ''}</td><td>${r.gpa ?? ''}</td>
      <td>${r.credit_gpa ?? ''}</td><td>${r.avg_gpa ?? ''}</td><td>${r.avg_score ?? ''}</td>
      <td>${esc(r.admin_class || '')}</td><td>${esc(r.class_name || '')}</td>
      <td><button class="btn btn-sm" data-action="grade-summary-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="grade-summary-delete" data-id="${r.id}">删除</button></td>
    </tr>`).join('');
  const gradeRows = courseGrades.map((r) => `
    <tr>
      <td>${esc(r.semester)}</td><td>${esc(r.student_no)}</td><td>${esc(r.student_name)}</td><td>${esc(r.course_name)}</td>
      <td>${r.score ?? ''}</td>
      <td>${r.is_failed ? '<span class="badge badge-red">是</span>' : '否'}</td>
      <td>${r.is_makeup ? '<span class="badge badge-amber">是</span>' : '否'}</td>
      <td>${r.is_retake ? '<span class="badge badge-blue">是</span>' : '否'}</td><td>${esc(r.notes)}</td>
      <td><button class="btn btn-sm" data-action="grade-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="grade-delete" data-id="${r.id}">删除</button></td>
    </tr>`).join('');
  const evalRows = evaluations.map((r) => `
    <tr>
      <td>${esc(r.academic_year)}</td><td>${esc(r.student_no)}</td><td>${esc(r.student_name)}</td>
      <td>${r.add_points}</td><td>${r.deduct_points}</td><td>${r.total_score}</td><td>${esc(r.notes)}</td>
      <td><button class="btn btn-sm" data-action="eval-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="eval-delete" data-id="${r.id}">删除</button></td>
    </tr>`).join('');

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>成绩与综测</h2><p>可直接查看全部学生，点击行内操作直接修改，无需先筛选。</p></div>
      <div class="page-actions">
        <button class="btn" data-action="grade-summary-template">${icon('file-down')}成绩模板</button>
        <button class="btn btn-primary" data-action="grade-summary-import">${icon('file-up')}导入成绩</button>
        <button class="btn" data-action="grade-summary-add">${icon('plus')}新增汇总</button>
        <button class="btn" data-action="grade-add">${icon('plus')}新增课程成绩</button>
        <button class="btn" data-action="eval-template">${icon('file-down')}综测模板</button>
        <button class="btn btn-primary" data-action="eval-import">${icon('file-up')}导入综测</button>
        <button class="btn" data-action="eval-add">${icon('plus')}新增综测</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>查询</span><input id="grades-keyword" value="${esc(state.gradesKeyword)}" placeholder="姓名 / 学号 / 身份证 / 政治面貌"></div>
      <button class="btn btn-primary" data-action="grades-query">${icon('search')}查询</button>
      <button class="btn" data-action="grades-reset">${icon('rotate-ccw')}重置</button>
    </div>
    <div class="panel">
      <h3 class="panel-title">成绩汇总（批量导入）</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>学期</th><th>学号</th><th>姓名</th><th>名次</th><th>修读环节数</th><th>未通过环节数</th><th>修读学分</th><th>获得学分</th><th>绩点</th><th>学分绩点</th><th>平均绩点</th><th>平均成绩</th><th>行政班级</th><th>班级</th><th>操作</th></tr></thead>
        <tbody>${summaryRows || '<tr><td colspan="15"><div class="empty-state">暂无成绩汇总</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">课程成绩</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>学期</th><th>学号</th><th>姓名</th><th>课程</th><th>分数</th><th>挂科</th><th>补考后</th><th>重修后</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${gradeRows || '<tr><td colspan="10"><div class="empty-state">暂无课程成绩</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">学年综测</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>学年</th><th>学号</th><th>姓名</th><th>加分</th><th>减分</th><th>总得分</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${evalRows || '<tr><td colspan="8"><div class="empty-state">暂无综测记录</div></td></tr>'}</tbody>
      </table></div>
    </div>
  `;
}

function openGradeForm(record = null) {
  state.modalStudent = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : null;
  const body = `
    <div class="form-grid">
      ${studentPickerHtml()}
      <div class="field"><span>学期</span><input id="g-semester" value="${esc(record ? record.semester : '')}" placeholder="如 2025-2026 第1学期"></div>
      <div class="field span-2"><span>课程名称</span><input id="g-course" value="${esc(record ? record.course_name : '')}"></div>
      <div class="field"><span>分数</span><input id="g-score" type="number" min="0" max="100" step="0.1" value="${record && record.score !== null ? record.score : ''}"></div>
      <label class="field"><span>是否挂科</span><select id="g-failed">${optionsHtml(['否', '是'], record && record.is_failed ? '是' : '否')}</select></label>
      <label class="field"><span>是否补考后成绩</span><select id="g-makeup">${optionsHtml(['否', '是'], record && record.is_makeup ? '是' : '否')}</select></label>
      <label class="field"><span>是否重修后成绩</span><select id="g-retake">${optionsHtml(['否', '是'], record && record.is_retake ? '是' : '否')}</select></label>
      <div class="field span-3"><span>备注</span><textarea id="g-notes">${esc(record ? record.notes : '')}</textarea></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑课程成绩' : '新增课程成绩', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-grade-btn">${icon('save')}保存</button>
  `));
  bindModalStudentPicker();
  $('#save-grade-btn').addEventListener('click', async () => {
    try {
      if (!state.modalStudent) throw new Error('请先选择学生');
      const payload = {
        student_id: state.modalStudent.id,
        semester: $('#g-semester').value.trim(),
        course_name: $('#g-course').value.trim(),
        score: $('#g-score').value,
        is_failed: $('#g-failed').value === '是',
        is_makeup: $('#g-makeup').value === '是',
        is_retake: $('#g-retake').value === '是',
        notes: $('#g-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.grades.update(payload); else await api.grades.create(payload);
      closeModal();
      renderGradesPage();
      toast('成绩已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openGradeSummaryForm(record = null) {
  state.modalStudent = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : null;
  const val = (key) => record ? (record[key] ?? '') : '';
  const body = `
    <div class="form-grid">
      ${studentPickerHtml()}
      <div class="field span-3"><span>学期</span><input id="gs-semester" value="${esc(val('semester'))}" placeholder="如 2025-2026 第1学期"></div>
      <div class="field"><span>名次</span><input id="gs-rank" type="number" min="1" value="${esc(val('rank'))}"></div>
      <div class="field"><span>修读课程环节数</span><input id="gs-course-count" type="number" min="0" value="${esc(val('course_count'))}"></div>
      <div class="field"><span>未通过课程环节数</span><input id="gs-failed-count" type="number" min="0" value="${esc(val('failed_course_count'))}"></div>
      <div class="field"><span>修读学分</span><input id="gs-credits-taken" type="number" step="0.01" value="${esc(val('credits_taken'))}"></div>
      <div class="field"><span>获得学分</span><input id="gs-credits-earned" type="number" step="0.01" value="${esc(val('credits_earned'))}"></div>
      <div class="field"><span>绩点</span><input id="gs-gpa" type="number" step="0.01" value="${esc(val('gpa'))}"></div>
      <div class="field"><span>学分绩点</span><input id="gs-credit-gpa" type="number" step="0.01" value="${esc(val('credit_gpa'))}"></div>
      <div class="field"><span>平均学分绩点</span><input id="gs-avg-gpa" type="number" step="0.01" value="${esc(val('avg_gpa'))}"></div>
      <div class="field"><span>平均成绩</span><input id="gs-avg-score" type="number" step="0.01" value="${esc(val('avg_score'))}"></div>
      <div class="field"><span>行政班级</span><input id="gs-admin-class" value="${esc(val('admin_class'))}"></div>
      <div class="field span-2"><span>班级</span><input id="gs-class" value="${esc(val('class_name'))}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑成绩汇总' : '新增成绩汇总', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-grade-summary-btn">${icon('save')}保存</button>
  `));
  bindModalStudentPicker();
  $('#save-grade-summary-btn').addEventListener('click', async () => {
    try {
      if (!state.modalStudent) throw new Error('请先选择学生');
      const payload = {
        student_id: state.modalStudent.id,
        semester: $('#gs-semester').value.trim(),
        rank: $('#gs-rank').value,
        course_count: $('#gs-course-count').value,
        failed_course_count: $('#gs-failed-count').value,
        credits_taken: $('#gs-credits-taken').value,
        credits_earned: $('#gs-credits-earned').value,
        gpa: $('#gs-gpa').value,
        credit_gpa: $('#gs-credit-gpa').value,
        avg_gpa: $('#gs-avg-gpa').value,
        avg_score: $('#gs-avg-score').value,
        admin_class: $('#gs-admin-class').value.trim(),
        class_name: $('#gs-class').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.grades.updateSummary(payload); else await api.grades.createSummary(payload);
      closeModal();
      renderGradesPage();
      toast('成绩汇总已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openEvalForm(record = null) {
  state.modalStudent = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : null;
  const body = `
    <div class="form-grid">
      ${studentPickerHtml()}
      <div class="field span-3"><span>学年</span><input id="e-year" value="${esc(record ? record.academic_year : '')}" placeholder="如 2025-2026"></div>
      <div class="field"><span>加分</span><input id="e-add" type="number" step="0.01" value="${record ? record.add_points : ''}"></div>
      <div class="field"><span>减分</span><input id="e-deduct" type="number" step="0.01" value="${record ? record.deduct_points : ''}"></div>
      <div class="field"><span>总得分（留空自动按加分-减分）</span><input id="e-total" type="number" step="0.01" value="${record ? record.total_score : ''}"></div>
      <div class="field span-3"><span>备注</span><textarea id="e-notes">${esc(record ? record.notes : '')}</textarea></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑综测' : '新增综测', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-eval-btn">${icon('save')}保存</button>
  `));
  bindModalStudentPicker();
  $('#save-eval-btn').addEventListener('click', async () => {
    try {
      if (!state.modalStudent) throw new Error('请先选择学生');
      const payload = {
        student_id: state.modalStudent.id,
        academic_year: $('#e-year').value.trim(),
        add_points: $('#e-add').value,
        deduct_points: $('#e-deduct').value,
        total_score: $('#e-total').value,
        notes: $('#e-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.evaluations.update(payload); else await api.evaluations.create(payload);
      closeModal();
      renderGradesPage();
      toast('综测已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function showImportReport(report) {
  if (!report) return;
  openModal(modalShell('导入结果', `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">成功导入</div><div class="stat-value">${report.imported.length}</div></div>
      <div class="stat-card"><div class="stat-label">跳过</div><div class="stat-value">${report.skipped.length}</div></div>
    </div>
    ${report.error_file ? `<p style="margin:10px 0;color:var(--muted);font-size:12px">错误数据已自动导出：${esc(report.error_file)}</p>` : ''}
    ${report.skipped.length ? `<div class="table-wrap"><table><thead><tr><th>Excel行</th><th>学号</th><th>姓名</th><th>原因</th></tr></thead><tbody>${report.skipped.map((s) => `<tr><td>${s.line}</td><td>${esc(s.student_no)}</td><td>${esc(s.name)}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">没有跳过行</div>'}
  `, `<button class="btn btn-primary" data-close-modal>完成</button>`));
}

function openImportDialog(options) {
  state.importContext = options;
  openModal(modalShell(options.title, `
    <div class="form-grid">
      <div class="field span-3"><span>${options.fieldLabel}</span><input id="import-option" placeholder="${esc(options.placeholder)}"></div>
    </div>
  `, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="start-import-btn">${icon('file-up')}选择文件并导入</button>
  `, { narrow: true }));
  $('#start-import-btn').addEventListener('click', async () => {
    try {
      const option = $('#import-option').value.trim();
      const report = await state.importContext.handler(option);
      if (report) {
        closeModal();
        showImportReport(report);
        renderPage(state.page);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openGradeImportDialog() {
  openImportDialog({
    title: '导入成绩汇总',
    fieldLabel: '默认学期（文件中“学期”列留空时使用）',
    placeholder: '如 2025-2026 第1学期',
    handler: (semester) => api.grades.importSummaries(semester)
  });
}

function openEvalImportDialog() {
  openImportDialog({
    title: '导入综测',
    fieldLabel: '默认学年（文件中“学年”列留空时使用）',
    placeholder: '如 2025-2026',
    handler: (academicYear) => api.evaluations.import(academicYear)
  });
}

function openAttendanceImportDialog() {
  openImportDialog({
    title: '导入考勤',
    fieldLabel: '默认学期（文件中“学期”列留空时使用）',
    placeholder: '如 2025-2026 第1学期',
    handler: (semester) => api.attendance.import(semester)
  });
}

async function renderAttendancePage() {
  const filters = { ...state.attendanceFilters };
  if (state.attendanceStudent) filters.student_id = state.attendanceStudent.id;
  const [records, cumulative] = await Promise.all([
    api.attendance.list(filters),
    api.attendance.cumulative(state.attendanceFilters.semester || '')
  ]);
  let statsHtml = '';
  if (state.attendanceStudent) {
    const stats = await api.attendance.stats(state.attendanceStudent.id, state.attendanceFilters.semester || '');
    statsHtml = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">旷课学时</div><div class="stat-value">${stats.absent_periods}</div></div>
        <div class="stat-card"><div class="stat-label">迟到次数</div><div class="stat-value">${stats.late_count}</div></div>
        <div class="stat-card"><div class="stat-label">早退次数</div><div class="stat-value">${stats.early_count}</div></div>
        <div class="stat-card"><div class="stat-label">折算旷课学时</div><div class="stat-value">${stats.equivalent_absent}</div><div class="stat-note">旷课 + (迟到+早退)÷3 向下取整</div></div>
      </div>
    `;
  }
  const cumulativeRows = cumulative.map((r) => `
    <tr>
      <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
      <td>${r.absent_periods}</td><td>${r.late_count}</td><td>${r.early_count}</td><td><strong>${r.equivalent_absent}</strong></td>
    </tr>`).join('');
  const rows = records.map((r) => `
    <tr>
      <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td><td>${esc(r.semester)}</td>
      <td>第${r.week_no}周</td><td>${r.start_period}-${r.end_period}节</td><td><span class="badge ${r.attendance_type === '旷课' ? 'badge-red' : 'badge-amber'}">${esc(r.attendance_type)}</span></td>
      <td>${r.period_count}</td><td>${esc(r.notes)}</td>
      <td><button class="btn btn-sm" data-action="attendance-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="attendance-delete" data-id="${r.id}">删除</button></td>
    </tr>`).join('');

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>考勤管理</h2><p>直接查看全部考勤记录，并按学生姓名累计统计学时。</p></div>
      <div class="page-actions">
        <button class="btn" data-action="attendance-template">${icon('file-down')}下载模板</button>
        <button class="btn btn-primary" data-action="attendance-import">${icon('file-up')}导入考勤</button>
        <button class="btn btn-success" data-action="attendance-export">${icon('download')}导出考勤</button>
        <button class="btn btn-primary" data-action="attendance-add">${icon('plus')}新增考勤</button>
        <button class="btn btn-danger" data-action="attendance-batch-delete">${icon('trash-2')}批量删除</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>学生查询</span><input id="attendance-keyword" value="${esc(state.attendanceFilters.keyword)}" placeholder="输入姓名 / 学号 / 身份证 / 政治面貌"></div>
      <div class="field"><span>学期</span><input id="attendance-semester" value="${esc(state.attendanceFilters.semester)}" placeholder="如 2025-2026 第1学期"></div>
      <button class="btn btn-primary" data-action="attendance-search">${icon('search')}查询</button>
      <button class="btn" data-action="attendance-clear">${icon('rotate-ccw')}清空</button>
      ${state.attendanceStudent ? `<span class="badge badge-blue">当前学生：${esc(state.attendanceStudent.name)}（${esc(state.attendanceStudent.student_no)}）</span>` : ''}
    </div>
    ${statsHtml}
    <div class="panel">
      <h3 class="panel-title">个人学时累计统计</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>学号</th><th>班级</th><th>旷课学时</th><th>迟到次数</th><th>早退次数</th><th>折算旷课学时</th></tr></thead>
        <tbody>${cumulativeRows || '<tr><td colspan="7"><div class="empty-state">暂无考勤数据</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">考勤明细</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>学号</th><th>班级</th><th>学期</th><th>周次</th><th>节次</th><th>类型</th><th>学时</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10"><div class="empty-state">暂无考勤记录</div></td></tr>'}</tbody>
      </table></div>
    </div>
  `;
}

function openAttendanceForm(record = null) {
  state.modalStudent = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : null;
  const body = `
    <div class="form-grid">
      ${studentPickerHtml()}
      <div class="field"><span>学期</span><input id="a-semester" value="${esc(record ? record.semester : '')}" placeholder="如 2025-2026 第1学期"></div>
      <div class="field"><span>周次</span><input id="a-week" type="number" min="1" value="${record ? record.week_no : ''}"></div>
      <div class="field"><span>类型</span><select id="a-type">${optionsHtml(['旷课', '迟到', '早退'], record ? record.attendance_type : '旷课')}</select></div>
      <div class="field"><span>开始节次</span><input id="a-start" type="number" min="1" value="${record ? record.start_period : ''}"></div>
      <div class="field"><span>结束节次</span><input id="a-end" type="number" min="1" value="${record ? record.end_period : ''}"></div>
      <div class="field"><span>备注</span><input id="a-notes" value="${esc(record ? record.notes : '')}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑考勤' : '新增考勤', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-attendance-btn">${icon('save')}保存</button>
  `));
  bindModalStudentPicker();
  $('#save-attendance-btn').addEventListener('click', async () => {
    try {
      if (!state.modalStudent) throw new Error('请先选择学生');
      const payload = {
        student_id: state.modalStudent.id,
        semester: $('#a-semester').value.trim(),
        week_no: $('#a-week').value,
        start_period: $('#a-start').value,
        end_period: $('#a-end').value,
        attendance_type: $('#a-type').value,
        notes: $('#a-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.attendance.update(payload); else await api.attendance.create(payload);
      closeModal();
      renderAttendancePage();
      toast('考勤已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function renderRecordPage(type) {
  const isDiscipline = type === 'discipline';
  const student = isDiscipline ? state.disciplineStudent : state.rewardStudent;
  const filters = isDiscipline ? state.disciplineFilters : state.rewardFilters;
  if (student) filters.student_id = student.id;
  return api[isDiscipline ? 'discipline' : 'rewards'].list(filters).then((records) => {
    const rows = records.map((r) => isDiscipline ? `
      <tr>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td><span class="badge badge-red">${esc(r.punishment_type)}</span></td><td>${esc(r.reason)}</td><td>${esc(r.punishment_date)}</td>
        <td>${esc(r.status)}</td><td>${esc(r.revoke_date || '')}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="${type}-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="${type}-delete" data-id="${r.id}">删除</button></td>
      </tr>` : `
      <tr>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td><span class="badge badge-green">${esc(r.award_name)}</span></td><td>${esc(r.issuer || '')}</td><td>${esc(r.award_date)}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="${type}-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="${type}-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');

    $('#content').innerHTML = `
      <div class="page-head">
        <div><h2>${isDiscipline ? '处分记录' : '奖励记录'}</h2><p>${isDiscipline ? '记录学生处分原因、类型、状态与撤销时间。' : '记录学生参加活动获得的奖项、颁发单位与时间。'}</p></div>
        <div class="page-actions"><button class="btn btn-primary" data-action="${type}-add">${icon('plus')}新增${isDiscipline ? '处分' : '奖励'}</button></div>
      </div>
      <div class="toolbar">
        <div class="field"><span>学生查询</span><input id="${type}-keyword" value="${esc(filters.keyword)}" placeholder="输入姓名 / 学号 / 身份证 / 政治面貌"></div>
        <button class="btn btn-primary" data-action="${type}-search">${icon('search')}查询</button>
        <button class="btn" data-action="${type}-clear">${icon('rotate-ccw')}清空</button>
        ${student ? `<span class="badge badge-blue">当前学生：${esc(student.name)}（${esc(student.student_no)}）</span>` : ''}
      </div>
      <div class="panel">
        <div class="table-wrap"><table>
          <thead>${isDiscipline ? '<tr><th>姓名</th><th>学号</th><th>班级</th><th>处分</th><th>原因</th><th>时间</th><th>状态</th><th>撤销时间</th><th>备注</th><th>操作</th></tr>' : '<tr><th>姓名</th><th>学号</th><th>班级</th><th>奖项</th><th>颁发单位</th><th>时间</th><th>备注</th><th>操作</th></tr>'}</thead>
          <tbody>${rows || `<tr><td colspan="${isDiscipline ? 10 : 8}"><div class="empty-state">暂无记录</div></td></tr>`}</tbody>
        </table></div>
      </div>
    `;
  });
}

function openDisciplineForm(record = null) {
  state.modalStudent = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : null;
  const body = `
    <div class="form-grid">
      ${studentPickerHtml()}
      <div class="field span-3"><span>处分原因</span><textarea id="d-reason">${esc(record ? record.reason : '')}</textarea></div>
      <div class="field"><span>处分类型</span><select id="d-type">${optionsHtml(DISCIPLINE_TYPES, record ? record.punishment_type : '')}</select></div>
      <div class="field"><span>处分时间</span><input id="d-date" type="date" value="${esc(record ? record.punishment_date : '')}"></div>
      <div class="field"><span>当前状态</span><select id="d-status">${optionsHtml(DISCIPLINE_STATUSES, record ? record.status : '处分中')}</select></div>
      <div class="field"><span>撤销时间</span><input id="d-revoke" type="date" value="${esc(record ? record.revoke_date || '' : '')}"></div>
      <div class="field span-2"><span>备注</span><input id="d-notes" value="${esc(record ? record.notes : '')}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑处分' : '新增处分', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-discipline-btn">${icon('save')}保存</button>
  `));
  bindModalStudentPicker();
  $('#save-discipline-btn').addEventListener('click', async () => {
    try {
      if (!state.modalStudent) throw new Error('请先选择学生');
      const payload = {
        student_id: state.modalStudent.id,
        reason: $('#d-reason').value.trim(),
        punishment_type: $('#d-type').value,
        punishment_date: $('#d-date').value,
        status: $('#d-status').value,
        revoke_date: $('#d-revoke').value,
        notes: $('#d-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.discipline.update(payload); else await api.discipline.create(payload);
      closeModal();
      renderDisciplinePage();
      toast('处分记录已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openRewardForm(record = null) {
  state.modalStudent = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : null;
  const body = `
    <div class="form-grid">
      ${studentPickerHtml()}
      <div class="field span-2"><span>奖项名称（可手动输入）</span><input id="r-award" value="${esc(record ? record.award_name : '')}"></div>
      <div class="field"><span>获奖时间（年月或年月日）</span><input id="r-date" type="text" placeholder="如 2026年5月 / 2026年5月20日" value="${esc(record ? record.award_date : '')}"></div>
      <div class="field span-2"><span>颁发单位</span><input id="r-issuer" value="${esc(record ? record.issuer || '' : '')}"></div>
      <div class="field"><span>备注</span><input id="r-notes" value="${esc(record ? record.notes : '')}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑奖励' : '新增奖励', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-reward-btn">${icon('save')}保存</button>
  `));
  bindModalStudentPicker();
  $('#save-reward-btn').addEventListener('click', async () => {
    try {
      if (!state.modalStudent) throw new Error('请先选择学生');
      const payload = {
        student_id: state.modalStudent.id,
        award_name: $('#r-award').value.trim(),
        issuer: $('#r-issuer').value.trim(),
        award_date: $('#r-date').value,
        notes: $('#r-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.rewards.update(payload); else await api.rewards.create(payload);
      closeModal();
      renderRewardsPage();
      toast('奖励记录已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderGradesPage() {
  const filters = state.gradesFilters;
  const [summaries, evaluations] = await Promise.all([
    api.grades.listSummaries({ keyword: filters.keyword, semester: filters.semester }),
    api.evaluations.listAll({ keyword: filters.keyword, academic_year: filters.academicYear })
  ]);

  const gradeGroups = {};
  summaries.forEach((r) => {
    (gradeGroups[r.semester] ||= []).push(r);
  });
  const semesterHtml = Object.keys(gradeGroups).sort().reverse().map((semester) => {
    const rows = gradeGroups[semester].map((r) => `
      <tr>
        <td>${esc(r.student_no)}</td><td>${esc(r.student_name)}</td><td>${r.rank ?? ''}</td>
        <td>${r.course_count ?? ''}</td><td>${r.failed_course_count ?? ''}</td><td>${r.credits_taken ?? ''}</td>
        <td>${r.credits_earned ?? ''}</td><td>${r.gpa ?? ''}</td><td>${r.credit_gpa ?? ''}</td>
        <td>${r.avg_gpa ?? ''}</td><td>${r.avg_score ?? ''}</td><td>${esc(r.admin_class || '')}</td><td>${esc(r.class_name || '')}</td>
        <td><button class="btn btn-sm" data-action="grade-summary-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="grade-summary-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');
    return `
      <div class="semester-group">
        <button type="button" class="semester-head" data-action="toggle-semester">${icon('chevron-right')}<strong>${esc(semester)}</strong><span>${gradeGroups[semester].length} 人</span></button>
        <div class="semester-body hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>学号</th><th>姓名</th><th>名次</th><th>修读环节数</th><th>未通过环节数</th><th>修读学分</th><th>获得学分</th><th>绩点</th><th>学分绩点</th><th>平均绩点</th><th>平均成绩</th><th>行政班级</th><th>班级</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  }).join('') || '<div class="empty-state">暂无成绩汇总数据</div>';

  const evalGroups = {};
  evaluations.forEach((r) => {
    (evalGroups[r.academic_year] ||= []).push(r);
  });
  const evalHtml = Object.keys(evalGroups).sort().reverse().map((year) => {
    const rows = evalGroups[year].map((r) => `
      <tr>
        <td>${esc(r.student_no)}</td><td>${esc(r.student_name)}</td><td>${r.add_points}</td><td>${r.deduct_points}</td><td>${r.total_score}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="eval-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="eval-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');
    return `
      <div class="semester-group">
        <button type="button" class="semester-head" data-action="toggle-semester">${icon('chevron-right')}<strong>${esc(year)}</strong><span>${evalGroups[year].length} 人</span></button>
        <div class="semester-body hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>学号</th><th>姓名</th><th>加分</th><th>减分</th><th>总得分</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  }).join('') || '<div class="empty-state">暂无综测数据</div>';

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>成绩与综测</h2><p>点击学期或学年标题展开查看详细数据，支持按学期/学年筛选和导入导出。</p></div>
      <div class="page-actions">
        <button class="btn" data-action="grade-summary-template">${icon('file-down')}成绩模板</button>
        <button class="btn btn-primary" data-action="grade-summary-import">${icon('file-up')}导入成绩</button>
        <button class="btn btn-success" data-action="grade-summary-export">${icon('download')}导出成绩</button>
        <button class="btn" data-action="grade-summary-add">${icon('plus')}新增汇总</button>
        <button class="btn" data-action="eval-template">${icon('file-down')}综测模板</button>
        <button class="btn btn-primary" data-action="eval-import">${icon('file-up')}导入综测</button>
        <button class="btn btn-success" data-action="eval-export">${icon('download')}导出综测</button>
        <button class="btn" data-action="eval-add">${icon('plus')}新增综测</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>关键字</span><input id="grades-keyword" value="${esc(filters.keyword)}" placeholder="姓名 / 学号 / 身份证 / 政治面貌"></div>
      <div class="field"><span>学期</span><input id="grades-semester" value="${esc(filters.semester)}" placeholder="如 2025-2026 第1学期"></div>
      <div class="field"><span>学年</span><input id="grades-year" value="${esc(filters.academicYear)}" placeholder="如 2025-2026"></div>
      <button class="btn btn-primary" data-action="grades-query">${icon('search')}查询</button>
      <button class="btn" data-action="grades-reset">${icon('rotate-ccw')}重置</button>
    </div>
    <div class="panel">
      <h3 class="panel-title">成绩汇总（按学期展开）</h3>
      ${semesterHtml}
    </div>
    <div class="panel">
      <h3 class="panel-title">学年综测（按学年展开）</h3>
      ${evalHtml}
    </div>
  `;
}

function renderRecordPage(type) {
  const isDiscipline = type === 'discipline';
  const student = isDiscipline ? state.disciplineStudent : state.rewardStudent;
  const filters = isDiscipline ? { ...state.disciplineFilters } : { ...state.rewardFilters };
  if (student) filters.student_id = student.id;
  else delete filters.student_id;
  return api[isDiscipline ? 'discipline' : 'rewards'].list(filters).then((records) => {
    const rows = records.map((r) => isDiscipline ? `
      <tr>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td><span class="badge badge-red">${esc(r.punishment_type)}</span></td><td>${esc(r.reason)}</td><td>${esc(r.punishment_date)}</td>
        <td>${esc(r.status)}</td><td>${esc(r.revoke_date || '')}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="${type}-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="${type}-delete" data-id="${r.id}">删除</button></td>
      </tr>` : `
      <tr>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td><span class="badge badge-green">${esc(r.award_name)}</span></td><td>${esc(r.issuer || '')}</td><td>${esc(r.award_date)}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="${type}-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="${type}-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');
    const extraFilters = isDiscipline ? `
      <div class="field"><span>处分类型</span><select id="discipline-type"><option value="">全部类型</option>${optionsHtml(DISCIPLINE_TYPES, filters.punishmentType)}</select></div>
      <div class="field"><span>处分状态</span><select id="discipline-status"><option value="">全部状态</option>${optionsHtml(DISCIPLINE_STATUSES, filters.status)}</select></div>
    ` : `
      <div class="field"><span>奖项名称</span><input id="reward-award" value="${esc(filters.awardName)}" placeholder="输入奖项名称"></div>
    `;
    $('#content').innerHTML = `
      <div class="page-head">
        <div><h2>${isDiscipline ? '处分记录' : '奖励记录'}</h2><p>${isDiscipline ? '记录学生处分原因、类型、状态与撤销时间。' : '记录学生获得的奖项、颁发单位与时间。'}</p></div>
        <div class="page-actions">
          <button class="btn" data-action="${type}-template">${icon('file-down')}下载模板</button>
          <button class="btn btn-primary" data-action="${type}-import">${icon('file-up')}导入${isDiscipline ? '处分' : '奖励'}</button>
          <button class="btn btn-success" data-action="${type}-export">${icon('download')}导出${isDiscipline ? '处分' : '奖励'}</button>
          <button class="btn btn-primary" data-action="${type}-add">${icon('plus')}新增${isDiscipline ? '处分' : '奖励'}</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="field"><span>学生查询</span><input id="${type}-keyword" value="${esc(filters.keyword)}" placeholder="输入姓名 / 学号 / 身份证 / 政治面貌"></div>
        ${extraFilters}
        <button class="btn btn-primary" data-action="${type}-search">${icon('search')}查询</button>
        <button class="btn" data-action="${type}-clear">${icon('rotate-ccw')}清空</button>
        ${student ? `<span class="badge badge-blue">当前学生：${esc(student.name)}（${esc(student.student_no)}）</span>` : ''}
      </div>
      <div class="panel">
        <div class="table-wrap"><table>
          <thead>${isDiscipline ? '<tr><th>姓名</th><th>学号</th><th>班级</th><th>处分</th><th>原因</th><th>时间</th><th>状态</th><th>撤销时间</th><th>备注</th><th>操作</th></tr>' : '<tr><th>姓名</th><th>学号</th><th>班级</th><th>奖项</th><th>颁发单位</th><th>时间</th><th>备注</th><th>操作</th></tr>'}</thead>
          <tbody>${rows || `<tr><td colspan="${isDiscipline ? 10 : 8}"><div class="empty-state">暂无记录</div></td></tr>`}</tbody>
        </table></div>
      </div>
    `;
  });
}

async function openStudentDetail(studentId) {
  const detail = await api.students.getDetail(studentId);
  const s = detail.student;
  const profileItems = [
    ['学号', s.student_no], ['身份证号码', s.id_card], ['年级', s.grade], ['学制', s.school_years], ['专业', s.major],
    ['班级', s.class_name], ['政治面貌', s.political_status], ['性别', s.gender], ['手机号', s.phone], ['社区', s.community],
    ['寝室号', s.dorm_room], ['床位', s.bed_no], ['出生日期', formatDate(s.birth_date)], ['民族', s.ethnicity], ['户籍地址', s.household_address],
    ['实际住址', s.current_address], ['父亲', s.father_name ? `${s.father_name} ${s.father_phone || ''}` : ''],
    ['母亲', s.mother_name ? `${s.mother_name} ${s.mother_phone || ''}` : ''],
    ['紧急联系人', s.emergency_name ? `${s.emergency_name} ${s.emergency_phone || ''}` : ''],
    ['特长', s.talents], ['贫困标记', s.poverty_status], ['困难认定', s.hardship_level], ['助学金', s.scholarship_level],
    ['学籍状态', s.enrollment_status], ['辅导员', s.counselor]
  ].filter(([, v]) => String(v ?? '').trim());

  const gradeSummaryRows = (detail.grade_summaries || []).map((r) => `<tr><td>${esc(r.semester)}</td><td>${r.rank ?? ''}</td><td>${r.credits_taken ?? ''}</td><td>${r.credits_earned ?? ''}</td><td>${r.gpa ?? ''}</td><td>${r.avg_gpa ?? ''}</td><td>${r.avg_score ?? ''}</td></tr>`).join('');
  const evalRows = (detail.evaluations || []).map((r) => `<tr><td>${esc(r.academic_year)}</td><td>${r.add_points}</td><td>${r.deduct_points}</td><td>${r.total_score}</td><td>${esc(r.notes)}</td></tr>`).join('');
  const attendanceRows = (detail.attendance || []).map((r) => `<tr><td>${esc(r.semester)}</td><td>第${r.week_no}周</td><td>${r.start_period}-${r.end_period}节</td><td>${esc(r.attendance_type)}</td><td>${r.period_count}</td></tr>`).join('');
  const disciplineRows = (detail.discipline || []).map((r) => `<tr><td>${esc(r.punishment_type)}</td><td>${esc(r.reason)}</td><td>${esc(r.punishment_date)}</td><td>${esc(r.status)}</td></tr>`).join('');
  const rewardRows = (detail.rewards || []).map((r) => `<tr><td>${esc(r.award_name)}</td><td>${esc(r.issuer || '')}</td><td>${esc(r.award_date)}</td></tr>`).join('');

  const section = (title, content) => `<div class="detail-section"><h4>${esc(title)}</h4>${content}</div>`;
  const table = (head, rows) => rows ? `<div class="table-wrap detail-mini-table"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state" style="padding:10px">暂无数据</div>';

  const body = `
    <div class="detail-page">
      <div class="detail-header">
        ${studentPhotoHtml({ ...s, photo_url: s.photo_url }, 'detail-photo')}
        <div class="detail-title">
          <h4>${esc(s.name)}</h4>
          <div class="meta">${esc(s.class_name)} · ${esc(s.student_no)} · ${esc(s.enrollment_status || '学籍状态未设置')}</div>
        </div>
        <button class="btn btn-primary" data-action="copy-student-detail" data-id="${s.id}">${icon('copy')}一键复制</button>
      </div>
      ${section('学生档案', `<div class="detail-grid detail-grid-wide">${profileItems.map(([k, v]) => `<div class="detail-item"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>`)}
      <div class="detail-main">
        ${section('成绩汇总', table('<tr><th>学期</th><th>名次</th><th>修读学分</th><th>获得学分</th><th>绩点</th><th>平均绩点</th><th>平均成绩</th></tr>', gradeSummaryRows))}
        ${section('学年综测', table('<tr><th>学年</th><th>加分</th><th>减分</th><th>总得分</th><th>备注</th></tr>', evalRows))}
        ${section('考勤记录', table('<tr><th>学期</th><th>周次</th><th>节次</th><th>类型</th><th>学时</th></tr>', attendanceRows))}
        ${section('处分记录', table('<tr><th>处分</th><th>原因</th><th>时间</th><th>状态</th></tr>', disciplineRows))}
        ${section('奖励记录', table('<tr><th>奖项</th><th>颁发单位</th><th>时间</th></tr>', rewardRows))}
      </div>
    </div>
  `;

  openModal(modalShell(`学生详情：${s.name}`, body, '', { wide: true }));
  $('#modal-root').addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action="copy-student-detail"]');
    if (!btn) return;
    try {
      await api.clipboard.writeText(copyStudentText(detail));
      toast('学生信息已复制到剪贴板', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderAttendancePage() {
  const filters = { ...state.attendanceFilters };
  if (state.attendanceStudent) filters.student_id = state.attendanceStudent.id;
  const [records, cumulative] = await Promise.all([
    api.attendance.list(filters),
    api.attendance.cumulative()
  ]);
  const visibleCumulative = state.attendanceStudent
    ? cumulative.filter((r) => r.student_id === state.attendanceStudent.id)
    : cumulative;

  let statsHtml = '';
  if (state.attendanceStudent) {
    const stats = await api.attendance.stats(state.attendanceStudent.id, state.attendanceFilters.semester || '');
    statsHtml = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">旷课学时</div><div class="stat-value">${stats.absent_periods}</div></div>
        <div class="stat-card"><div class="stat-label">迟到次数</div><div class="stat-value">${stats.late_count}</div></div>
        <div class="stat-card"><div class="stat-label">早退次数</div><div class="stat-value">${stats.early_count}</div></div>
        <div class="stat-card"><div class="stat-label">折算旷课学时</div><div class="stat-value">${stats.equivalent_absent}</div><div class="stat-note">旷课 + (迟到+早退)÷3 向下取整</div></div>
      </div>
    `;
  }

  const cumulativeRows = visibleCumulative.map((r) => `
    <tr>
      <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
      <td>${r.absent_periods}</td><td>${r.late_count}</td><td>${r.early_count}</td><td><strong>${r.equivalent_absent}</strong></td>
    </tr>`).join('');

  const groups = {};
  records.forEach((r) => {
    (groups[r.semester] ||= []).push(r);
  });
  const semesterHtml = Object.keys(groups).sort().reverse().map((semester) => {
    const rows = groups[semester].map((r) => `
      <tr>
        <td><input type="checkbox" class="attendance-check" data-id="${r.id}" ${state.selectedAttendanceIds.has(r.id) ? 'checked' : ''}></td>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td>第${r.week_no}周</td><td>${r.start_period}-${r.end_period}节</td><td><span class="badge ${r.attendance_type === '旷课' ? 'badge-red' : 'badge-amber'}">${esc(r.attendance_type)}</span></td>
        <td>${r.period_count}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="attendance-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="attendance-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');
    return `
      <div class="semester-group">
        <button type="button" class="semester-head" data-action="toggle-semester">${icon('chevron-right')}<strong>${esc(semester)}</strong><span>${groups[semester].length} 条记录</span></button>
        <div class="semester-body hidden">
          <div class="table-wrap"><table>
            <thead><tr><th><input type="checkbox" class="attendance-check-all" data-semester="${esc(semester)}"></th><th>姓名</th><th>学号</th><th>班级</th><th>周次</th><th>节次</th><th>类型</th><th>学时</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  }).join('') || '<div class="empty-state">暂无考勤记录</div>';

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>考勤管理</h2><p>选择学生后累计统计和明细只显示该学生；点击学期标题展开本学期考勤记录。</p></div>
      <div class="page-actions">
        <button class="btn" data-action="attendance-template">${icon('file-down')}下载模板</button>
        <button class="btn btn-primary" data-action="attendance-import">${icon('file-up')}导入考勤</button>
        <button class="btn btn-success" data-action="attendance-export">${icon('download')}导出考勤</button>
        <button class="btn btn-primary" data-action="attendance-add">${icon('plus')}新增考勤</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>学生查询</span><input id="attendance-keyword" value="${esc(state.attendanceFilters.keyword)}" placeholder="输入姓名 / 学号 / 身份证 / 政治面貌"></div>
      <div class="field"><span>学期</span><input id="attendance-semester" value="${esc(state.attendanceFilters.semester)}" placeholder="如 2025-2026 第1学期"></div>
      <button class="btn btn-primary" data-action="attendance-search">${icon('search')}查询</button>
      <button class="btn" data-action="attendance-clear">${icon('rotate-ccw')}清空</button>
      ${state.attendanceStudent ? `<span class="badge badge-blue">当前学生：${esc(state.attendanceStudent.name)}（${esc(state.attendanceStudent.student_no)}）</span>` : ''}
    </div>
    ${statsHtml}
    <div class="panel">
      <h3 class="panel-title">个人学时累计统计 ${state.attendanceStudent ? '<span class="subtle">已按当前学生筛选</span>' : ''}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>学号</th><th>班级</th><th>旷课学时</th><th>迟到次数</th><th>早退次数</th><th>折算旷课学时</th></tr></thead>
        <tbody>${cumulativeRows || '<tr><td colspan="7"><div class="empty-state">暂无考勤数据</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">考勤明细（按学期展开）</h3>
      ${semesterHtml}
    </div>
  `;
}

async function renderAttendancePage() {
  const filters = { ...state.attendanceFilters };
  if (state.attendanceStudent) filters.student_id = state.attendanceStudent.id;
  const [records, cumulative] = await Promise.all([
    api.attendance.list(filters),
    api.attendance.cumulative(state.attendanceFilters.semester || '')
  ]);
  const visibleCumulative = state.attendanceStudent
    ? cumulative.filter((r) => r.student_id === state.attendanceStudent.id)
    : cumulative;

  let statsHtml = '';
  if (state.attendanceStudent) {
    const stats = await api.attendance.stats(state.attendanceStudent.id, state.attendanceFilters.semester || '');
    statsHtml = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">旷课学时</div><div class="stat-value">${stats.absent_periods}</div></div>
        <div class="stat-card"><div class="stat-label">迟到次数</div><div class="stat-value">${stats.late_count}</div></div>
        <div class="stat-card"><div class="stat-label">早退次数</div><div class="stat-value">${stats.early_count}</div></div>
        <div class="stat-card"><div class="stat-label">折算旷课学时</div><div class="stat-value">${stats.equivalent_absent}</div><div class="stat-note">旷课 + (迟到+早退)÷3 向下取整</div></div>
      </div>
    `;
  }

  const cumulativeRows = visibleCumulative.map((r) => `
    <tr>
      <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
      <td>${r.absent_periods}</td><td>${r.late_count}</td><td>${r.early_count}</td><td><strong>${r.equivalent_absent}</strong></td>
    </tr>`).join('');

  const groups = {};
  records.forEach((r) => {
    (groups[r.semester] ||= []).push(r);
  });
  const semesterHtml = Object.keys(groups).sort().reverse().map((semester) => {
    const rows = groups[semester].map((r) => `
      <tr>
        <td><input type="checkbox" class="attendance-check" data-id="${r.id}" ${state.selectedAttendanceIds.has(r.id) ? 'checked' : ''}></td>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
        <td>第${r.week_no}周</td><td>${r.start_period}-${r.end_period}节</td><td><span class="badge ${r.attendance_type === '旷课' ? 'badge-red' : 'badge-amber'}">${esc(r.attendance_type)}</span></td>
        <td>${r.period_count}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="attendance-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="attendance-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');
    return `
      <div class="semester-group">
        <button type="button" class="semester-head" data-action="toggle-semester">${icon('chevron-right')}<strong>${esc(semester)}</strong><span>${groups[semester].length} 条记录</span></button>
        <div class="semester-body hidden">
          <div class="table-wrap"><table>
            <thead><tr><th><input type="checkbox" class="attendance-check-all" data-semester="${esc(semester)}"></th><th>姓名</th><th>学号</th><th>班级</th><th>周次</th><th>节次</th><th>类型</th><th>学时</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  }).join('') || '<div class="empty-state">暂无考勤记录</div>';

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>考勤管理</h2><p>选择学生后累计统计和明细只显示该学生；点击学期标题展开本学期考勤记录。</p></div>
      <div class="page-actions">
        <button class="btn" data-action="attendance-template">${icon('file-down')}下载模板</button>
        <button class="btn btn-primary" data-action="attendance-import">${icon('file-up')}导入考勤</button>
        <button class="btn btn-success" data-action="attendance-export">${icon('download')}导出考勤</button>
        <button class="btn btn-primary" data-action="attendance-add">${icon('plus')}新增考勤</button>
        <button class="btn btn-danger" data-action="attendance-batch-delete">${icon('trash-2')}批量删除</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>学生查询</span><input id="attendance-keyword" value="${esc(state.attendanceFilters.keyword)}" placeholder="输入姓名 / 学号 / 身份证 / 政治面貌"></div>
      <div class="field"><span>学期</span><input id="attendance-semester" value="${esc(state.attendanceFilters.semester)}" placeholder="如 2025-2026 第1学期"></div>
      <button class="btn btn-primary" data-action="attendance-search">${icon('search')}查询</button>
      <button class="btn" data-action="attendance-clear">${icon('rotate-ccw')}清空</button>
      ${state.attendanceStudent ? `<span class="badge badge-blue">当前学生：${esc(state.attendanceStudent.name)}（${esc(state.attendanceStudent.student_no)}）</span>` : ''}
    </div>
    ${statsHtml}
    <div class="panel">
      <h3 class="panel-title">个人学时累计统计 ${state.attendanceFilters.semester ? '<span class="subtle">已按学期筛选</span>' : ''}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>学号</th><th>班级</th><th>旷课学时</th><th>迟到次数</th><th>早退次数</th><th>折算旷课学时</th></tr></thead>
        <tbody>${cumulativeRows || '<tr><td colspan="7"><div class="empty-state">暂无考勤数据</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">考勤明细（按学期展开）</h3>
      ${semesterHtml}
    </div>
  `;
}

async function renderAttendancePage() {
  const filters = { ...state.attendanceFilters };
  if (state.attendanceStudent) filters.student_id = state.attendanceStudent.id;
  const [records, cumulative] = await Promise.all([
    api.attendance.list(filters),
    api.attendance.cumulative(state.attendanceFilters.semester || '')
  ]);
  const visibleCumulative = state.attendanceStudent
    ? cumulative.filter((r) => r.student_id === state.attendanceStudent.id)
    : cumulative;

  let statsHtml = '';
  if (state.attendanceStudent) {
    const stats = await api.attendance.stats(state.attendanceStudent.id, state.attendanceFilters.semester || '');
    statsHtml = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">旷课学时</div><div class="stat-value">${stats.absent_periods}</div></div>
        <div class="stat-card"><div class="stat-label">迟到次数</div><div class="stat-value">${stats.late_count}</div></div>
        <div class="stat-card"><div class="stat-label">早退次数</div><div class="stat-value">${stats.early_count}</div></div>
        <div class="stat-card"><div class="stat-label">折算旷课学时</div><div class="stat-value">${stats.equivalent_absent}</div><div class="stat-note">旷课 + (迟到+早退)÷3 向下取整</div></div>
      </div>
    `;
  }

  const cumulativeRows = visibleCumulative.map((r) => `
    <tr>
      <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td>
      <td>${r.absent_periods}</td><td>${r.late_count}</td><td>${r.early_count}</td><td><strong>${r.equivalent_absent}</strong></td>
    </tr>`).join('');

  const groups = {};
  records.forEach((r) => {
    (groups[r.semester] ||= []).push(r);
  });
  const semesterHtml = Object.keys(groups).sort().reverse().map((semester) => {
    const rows = groups[semester].map((r) => `
      <tr>
        <td><input type="checkbox" class="attendance-check" data-id="${r.id}" ${state.selectedAttendanceIds.has(r.id) ? 'checked' : ''}></td>
        <td>${esc(r.student_name)}</td><td>${esc(r.student_no)}</td><td>${esc(r.class_name)}</td><td>${esc(formatDate(r.attendance_date))}</td>
        <td>第${r.week_no}周</td><td>${r.start_period}-${r.end_period}节</td><td><span class="badge ${r.attendance_type === '旷课' ? 'badge-red' : 'badge-amber'}">${esc(r.attendance_type)}</span></td>
        <td>${r.period_count}</td><td>${esc(r.notes)}</td>
        <td><button class="btn btn-sm" data-action="attendance-edit" data-id="${r.id}">编辑</button><button class="btn btn-sm btn-danger" data-action="attendance-delete" data-id="${r.id}">删除</button></td>
      </tr>`).join('');
    return `
      <div class="semester-group">
        <button type="button" class="semester-head" data-action="toggle-semester">${icon('chevron-right')}<strong>${esc(semester)}</strong><span>${groups[semester].length} 条记录</span></button>
        <div class="semester-body hidden">
          <div class="table-wrap"><table>
            <thead><tr><th><input type="checkbox" class="attendance-check-all" data-semester="${esc(semester)}"></th><th>姓名</th><th>学号</th><th>班级</th><th>日期</th><th>周次</th><th>节次</th><th>类型</th><th>学时</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>`;
  }).join('') || '<div class="empty-state">暂无考勤记录</div>';

  $('#content').innerHTML = `
    <div class="page-head">
      <div><h2>考勤管理</h2><p>选择学生后累计统计和明细只显示该学生；点击学期标题展开本学期考勤记录。</p></div>
      <div class="page-actions">
        <button class="btn" data-action="attendance-template">${icon('file-down')}下载模板</button>
        <button class="btn btn-primary" data-action="attendance-import">${icon('file-up')}导入考勤</button>
        <button class="btn btn-success" data-action="attendance-export">${icon('download')}导出考勤</button>
        <button class="btn btn-primary" data-action="attendance-add">${icon('plus')}新增考勤</button>
        <button class="btn btn-danger" data-action="attendance-batch-delete">${icon('trash-2')}批量删除</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="field"><span>学生查询</span><input id="attendance-keyword" value="${esc(state.attendanceFilters.keyword)}" placeholder="输入姓名 / 学号 / 身份证 / 政治面貌"></div>
      <div class="field"><span>学期</span><input id="attendance-semester" value="${esc(state.attendanceFilters.semester)}" placeholder="如 2025-2026 第1学期"></div>
      <button class="btn btn-primary" data-action="attendance-search">${icon('search')}查询</button>
      <button class="btn" data-action="attendance-clear">${icon('rotate-ccw')}清空</button>
      ${state.attendanceStudent ? `<span class="badge badge-blue">当前学生：${esc(state.attendanceStudent.name)}（${esc(state.attendanceStudent.student_no)}）</span>` : ''}
    </div>
    ${statsHtml}
    <div class="panel">
      <h3 class="panel-title">个人学时累计统计 ${state.attendanceFilters.semester ? '<span class="subtle">已按学期筛选</span>' : ''}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>学号</th><th>班级</th><th>旷课学时</th><th>迟到次数</th><th>早退次数</th><th>折算旷课学时</th></tr></thead>
        <tbody>${cumulativeRows || '<tr><td colspan="7"><div class="empty-state">暂无考勤数据</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">考勤明细（按学期展开）</h3>
      ${semesterHtml}
    </div>
  `;
}

function openAttendanceForm(record = null) {
  state.modalStudent = record ? { id: record.student_id, name: record.student_name, student_no: record.student_no } : null;
  const body = `
    <div class="form-grid">
      ${studentPickerHtml()}
      <div class="field"><span>日期</span><input id="a-date" type="date" value="${esc(record ? formatDate(record.attendance_date) : '')}"></div>
      <div class="field"><span>学期</span><input id="a-semester" value="${esc(record ? record.semester : '')}" placeholder="如 2025-2026 第1学期"></div>
      <div class="field"><span>周次</span><input id="a-week" type="number" min="1" value="${record ? record.week_no : ''}"></div>
      <div class="field"><span>类型</span><select id="a-type">${optionsHtml(['旷课', '迟到', '早退'], record ? record.attendance_type : '旷课')}</select></div>
      <div class="field"><span>开始节次</span><input id="a-start" type="number" min="1" value="${record ? record.start_period : ''}"></div>
      <div class="field"><span>结束节次</span><input id="a-end" type="number" min="1" value="${record ? record.end_period : ''}"></div>
      <div class="field"><span>备注</span><input id="a-notes" value="${esc(record ? record.notes : '')}"></div>
    </div>
  `;
  openModal(modalShell(record ? '编辑考勤' : '新增考勤', body, `
    <button class="btn" data-close-modal>取消</button>
    <button class="btn btn-primary" id="save-attendance-btn">${icon('save')}保存</button>
  `));
  bindModalStudentPicker();
  $('#save-attendance-btn').addEventListener('click', async () => {
    try {
      if (!state.modalStudent) throw new Error('请先选择学生');
      const payload = {
        student_id: state.modalStudent.id,
        attendance_date: $('#a-date').value,
        semester: $('#a-semester').value.trim(),
        week_no: $('#a-week').value,
        start_period: $('#a-start').value,
        end_period: $('#a-end').value,
        attendance_type: $('#a-type').value,
        notes: $('#a-notes').value.trim()
      };
      if (record) payload.id = record.id;
      if (record) await api.attendance.update(payload); else await api.attendance.create(payload);
      closeModal();
      renderAttendancePage();
      toast('考勤已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
