const { contextBridge, ipcRenderer } = require('electron');

const TOKEN_KEY = 'student_manager_token';

function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

async function call(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload ?? {}, getToken());
  if (!result.ok) throw new Error(result.error || '操作失败');
  return result.data;
}

async function publicCall(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload ?? {}, '');
  if (!result.ok) throw new Error(result.error || '操作失败');
  return result.data;
}

const api = {
  auth: {
    async login(username, password) {
      const data = await publicCall('auth:login', { username, password });
      window.localStorage.setItem(TOKEN_KEY, data.token);
      return data.user;
    },
    async logout() {
      try {
        await call('auth:logout');
      } finally {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    },
    current: () => call('auth:current'),
    changePassword: (oldPassword, newPassword) => call('auth:changePassword', { oldPassword, newPassword })
  },
  users: {
    list: () => call('users:list'),
    create: (payload) => call('users:create', payload),
    update: (payload) => call('users:update', payload),
    remove: (id) => call('users:remove', { id })
  },
  students: {
    list: (filters) => call('students:list', filters || {}),
    listAll: (filters) => call('students:listAll', filters || {}),
    classes: (includeArchived) => call('students:classes', { includeArchived }),
    getDetail: (id) => call('students:getDetail', { id }),
    create: (payload) => call('students:create', payload),
    update: (payload) => call('students:update', payload),
    remove: (id) => call('students:remove', { id }),
    batchRemove: (ids) => call('students:batchRemove', { ids }),
    archive: (ids, archived) => call('students:archive', { ids, archived }),
    choosePhoto: (studentId) => call('students:choosePhoto', { studentId })
  },
  excel: {
    downloadTemplate: () => call('excel:downloadTemplate'),
    import: () => call('excel:import'),
    export: (payload) => call('excel:export', payload || {}),
    downloadGradeSummaryTemplate: () => call('excel:downloadGradeSummaryTemplate'),
    downloadEvaluationTemplate: () => call('excel:downloadEvaluationTemplate'),
    downloadAttendanceTemplate: () => call('excel:downloadAttendanceTemplate'),
    downloadDisciplineTemplate: () => call('excel:downloadDisciplineTemplate'),
    downloadRewardTemplate: () => call('excel:downloadRewardTemplate')
  },
  grades: {
    list: (studentId) => call('grades:list', { studentId }),
    listAll: (filters) => call('grades:listAll', filters || {}),
    get: (id) => call('grades:get', { id }),
    create: (payload) => call('grades:create', payload),
    update: (payload) => call('grades:update', payload),
    remove: (id) => call('grades:remove', { id }),
    listSummaries: (filters) => call('grades:listSummaries', filters || {}),
    getSummary: (id) => call('grades:getSummary', { id }),
    createSummary: (payload) => call('grades:createSummary', payload),
    updateSummary: (payload) => call('grades:updateSummary', payload),
    removeSummary: (id) => call('grades:removeSummary', { id }),
    importSummaries: (semester) => call('grades:import', { semester }),
    exportSummaries: (filters) => call('grades:exportSummaries', filters || {})
  },
  evaluations: {
    list: (studentId) => call('evaluations:list', { studentId }),
    listAll: (filters) => call('evaluations:listAll', filters || {}),
    get: (id) => call('evaluations:get', { id }),
    create: (payload) => call('evaluations:create', payload),
    update: (payload) => call('evaluations:update', payload),
    remove: (id) => call('evaluations:remove', { id }),
    import: (academicYear) => call('evaluations:import', { academicYear }),
    export: (filters) => call('evaluations:export', filters || {})
  },
  attendance: {
    list: (filters) => call('attendance:list', filters || {}),
    get: (id) => call('attendance:get', { id }),
    cumulative: (semester) => call('attendance:cumulative', { semester }),
    stats: (studentId, semester) => call('attendance:stats', { studentId, semester }),
    create: (payload) => call('attendance:create', payload),
    update: (payload) => call('attendance:update', payload),
    remove: (id) => call('attendance:remove', { id }),
    batchRemove: (ids) => call('attendance:batchRemove', { ids }),
    import: (semester) => call('attendance:import', { semester }),
    export: (filters) => call('attendance:export', filters || {})
  },
  discipline: {
    list: (filters) => call('discipline:list', filters || {}),
    get: (id) => call('discipline:get', { id }),
    create: (payload) => call('discipline:create', payload),
    update: (payload) => call('discipline:update', payload),
    remove: (id) => call('discipline:remove', { id }),
    import: () => call('discipline:import'),
    export: (filters) => call('discipline:export', filters || {})
  },
  rewards: {
    list: (filters) => call('rewards:list', filters || {}),
    get: (id) => call('rewards:get', { id }),
    create: (payload) => call('rewards:create', payload),
    update: (payload) => call('rewards:update', payload),
    remove: (id) => call('rewards:remove', { id }),
    import: () => call('rewards:import'),
    export: (filters) => call('rewards:export', filters || {})
  },
  dashboard: {
    stats: () => call('dashboard:stats')
  },
  logs: {
    list: (filters) => call('logs:list', filters || {})
  },
  settings: {
    statuses: () => call('settings:statuses'),
    createStatus: (payload) => call('settings:createStatus', payload),
    updateStatus: (payload) => call('settings:updateStatus', payload),
    removeStatus: (id) => call('settings:removeStatus', { id })
  },
  clipboard: {
    writeText: (text) => call('clipboard:writeText', { text })
  }
};

contextBridge.exposeInMainWorld('api', api);
