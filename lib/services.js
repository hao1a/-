const fs = require('node:fs');
const path = require('node:path');

class AppError extends Error {}

function escapeLike(value) {
  return String(value ?? '').replace(/[\\%_]/g, '\\$&');
}

function cleanText(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.trim();
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    last_login_at: row.last_login_at
  };
}

function rowToStudent(row, photosDir) {
  if (!row) return null;
  const result = { ...row };
  result.photo_url = row.photo_path && fs.existsSync(row.photo_path)
    ? require('node:url').pathToFileURL(row.photo_path).toString()
    : null;
  result.photo_file = row.photo_path ? path.basename(row.photo_path) : '';
  return result;
}

function validateStudent(input) {
  const data = {
    name: cleanText(input.name),
    student_no: cleanText(input.student_no),
    id_card: cleanText(input.id_card),
    phone: cleanText(input.phone),
    class_name: cleanText(input.class_name)
  };
  if (!data.name) throw new AppError('姓名不能为空');
  if (!data.student_no) throw new AppError('学号不能为空');
  if (!data.id_card) throw new AppError('身份证号码不能为空');
  if (!data.phone) throw new AppError('学生手机号不能为空');
  if (!data.class_name) throw new AppError('班级不能为空');

  const optionalFields = [
    'photo_path', 'grade', 'school_years', 'major', 'political_status', 'gender',
    'community', 'dorm_room', 'bed_no', 'birth_date', 'ethnicity', 'household_address',
    'current_address', 'father_name', 'father_phone', 'mother_name', 'mother_phone',
    'emergency_name', 'emergency_phone', 'talents', 'poverty_status', 'hardship_level',
    'scholarship_level', 'enrollment_status', 'counselor'
  ];
  optionalFields.forEach((field) => {
    data[field] = input[field] === null || input[field] === undefined ? '' : String(input[field]).trim();
  });
  return data;
}

function createServices(ctx) {
  const { db, photosDir, now, hashPassword, verifyPassword, transaction } = ctx;

  function logAction(user, action, module, targetType, targetId, detail) {
    db.prepare(
      'INSERT INTO operation_logs (user_id, username, action, module, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user?.id ?? null, user?.username ?? 'system', action, module, targetType ?? null, targetId ?? null, detail ?? '', now());
  }

  function authService() {
    return {
      login(username, password) {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanText(username));
        if (!user || !user.is_active || !verifyPassword(password, user.password_salt, user.password_hash)) {
          throw new AppError('用户名或密码错误');
        }
        const updated = now();
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(updated, user.id);
        logAction(publicUser(user), '登录', '认证', 'user', user.id, `用户 ${user.username} 登录`);
        return publicUser(user);
      },
      currentUser(userId) {
        return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
      },
      changePassword(user, oldPassword, newPassword) {
        if (!newPassword || String(newPassword).length < 6) throw new AppError('新密码至少 6 位');
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
        if (!verifyPassword(oldPassword, row.password_salt, row.password_hash)) {
          throw new AppError('原密码不正确');
        }
        const { salt, hash } = hashPassword(newPassword);
        db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id);
        logAction(user, '修改密码', '账号', 'user', user.id, '用户修改了自己的密码');
      }
    };
  }

  function userService() {
    return {
      list() {
        return db.prepare(
          'SELECT id, username, display_name, is_active, created_at, last_login_at FROM users ORDER BY id'
        ).all().map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
      },
      create(user, input) {
        const username = cleanText(input.username);
        const displayName = cleanText(input.display_name);
        const password = String(input.password ?? '');
        if (!username) throw new AppError('用户名不能为空');
        if (password.length < 6) throw new AppError('密码至少 6 位');
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
          throw new AppError('用户名已存在');
        }
        const { salt, hash } = hashPassword(password);
        const result = db.prepare(
          'INSERT INTO users (username, password_hash, password_salt, display_name, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(username, hash, salt, displayName || username, 1, now());
        logAction(user, '新增账号', '账号', 'user', Number(result.lastInsertRowid), `新增用户 ${username}`);
        return Number(result.lastInsertRowid);
      },
      update(user, input) {
        const targetId = Number(input.id);
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
        if (!row) throw new AppError('账号不存在');
        const displayName = cleanText(input.display_name) || row.username;
        const isActive = input.is_active === undefined ? Boolean(row.is_active) : Boolean(input.is_active);
        let hash = row.password_hash;
        let salt = row.password_salt;
        if (input.password) {
          if (String(input.password).length < 6) throw new AppError('密码至少 6 位');
          const generated = hashPassword(input.password);
          hash = generated.hash;
          salt = generated.salt;
        }
        db.prepare(
          'UPDATE users SET display_name = ?, is_active = ?, password_hash = ?, password_salt = ? WHERE id = ?'
        ).run(displayName, isActive ? 1 : 0, hash, salt, targetId);
        logAction(user, '编辑账号', '账号', 'user', targetId, `更新用户 ${row.username}`);
      },
      remove(user, userId) {
        const targetId = Number(userId);
        if (targetId === user.id) throw new AppError('不能删除当前登录账号');
        const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId);
        if (!row) throw new AppError('账号不存在');
        const activeCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_active = 1').get().c;
        if (activeCount <= 1) throw new AppError('至少保留一个可用账号');
        db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
        logAction(user, '删除账号', '账号', 'user', targetId, `删除用户 ${row.username}`);
      }
    };
  }

  function studentService() {
    const baseSelect = 'SELECT * FROM students';

    function checkUnique(data, excludeId) {
      const byNo = db.prepare('SELECT id FROM students WHERE student_no = ? AND id != ?').get(data.student_no, excludeId ?? -1);
      if (byNo) throw new AppError(`学号 ${data.student_no} 已存在`);
      const byId = db.prepare('SELECT id FROM students WHERE id_card = ? AND id != ?').get(data.id_card, excludeId ?? -1);
      if (byId) throw new AppError(`身份证号码 ${data.id_card} 已存在`);
    }

    function buildWhere(filters) {
      const where = [];
      const params = [];
      const keyword = cleanText(filters.keyword);
      const keywordType = filters.keywordType || 'any';
      if (keyword) {
        const like = `%${escapeLike(keyword)}%`;
        if (keywordType === 'student_no') {
          where.push('student_no LIKE ? ESCAPE \'\\\'');
          params.push(like);
        } else if (keywordType === 'name') {
          where.push('name LIKE ? ESCAPE \'\\\'');
          params.push(like);
        } else if (keywordType === 'id_card') {
          where.push('id_card LIKE ? ESCAPE \'\\\'');
          params.push(like);
        } else if (keywordType === 'political_status') {
          where.push('political_status LIKE ? ESCAPE \'\\\'');
          params.push(like);
        } else {
          where.push('(name LIKE ? ESCAPE \'\\\' OR student_no LIKE ? ESCAPE \'\\\' OR id_card LIKE ? ESCAPE \'\\\' OR political_status LIKE ? ESCAPE \'\\\')');
          params.push(like, like, like, like);
        }
      }
      const className = cleanText(filters.class_name ?? filters.className);
      const enrollmentStatus = cleanText(filters.enrollment_status ?? filters.enrollmentStatus);
      if (className) {
        where.push('class_name = ?');
        params.push(className);
      }
      if (enrollmentStatus) {
        where.push('enrollment_status = ?');
        params.push(enrollmentStatus);
      }
      if (cleanText(filters.political_status)) {
        where.push('political_status = ?');
        params.push(cleanText(filters.political_status));
      }
      if (filters.archived === '1') {
        where.push('is_archived = 1');
      } else if (filters.archived === 'all') {
        // 包含已归档
      } else {
        where.push('is_archived = 0');
      }
      return { where: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
    }

    return {
      list(filters = {}) {
        const { where, params } = buildWhere(filters);
        const page = Math.max(1, Number(filters.page) || 1);
        const pageSize = Math.min(500, Math.max(1, Number(filters.pageSize) || 50));
        const total = db.prepare(`SELECT COUNT(*) AS c FROM students${where}`).get(...params).c;
        const rows = db.prepare(`${baseSelect}${where} ORDER BY class_name, student_no LIMIT ? OFFSET ?`)
          .all(...params, pageSize, (page - 1) * pageSize)
          .map((row) => rowToStudent(row, photosDir));
        return { items: rows, total, page, pageSize };
      },
      listAll(filters = {}) {
        const { where, params } = buildWhere(filters);
        return db.prepare(`${baseSelect}${where} ORDER BY class_name, student_no`).all(...params)
          .map((row) => rowToStudent(row, photosDir));
      },
      get(id) {
        const row = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(id));
        return rowToStudent(row, photosDir);
      },
      getDetail(id) {
        const student = this.get(id);
        if (!student) throw new AppError('学生不存在');
        return {
          student,
          grades: db.prepare('SELECT * FROM semester_grades WHERE student_id = ? ORDER BY semester, course_name').all(student.id),
          grade_summaries: db.prepare('SELECT * FROM grade_summaries WHERE student_id = ? ORDER BY semester').all(student.id),
          evaluations: db.prepare('SELECT * FROM comprehensive_evaluations WHERE student_id = ? ORDER BY academic_year').all(student.id),
          attendance: db.prepare('SELECT * FROM attendance_records WHERE student_id = ? ORDER BY semester, week_no, start_period').all(student.id),
          discipline: db.prepare('SELECT * FROM disciplinary_records WHERE student_id = ? ORDER BY punishment_date DESC').all(student.id),
          rewards: db.prepare('SELECT * FROM reward_records WHERE student_id = ? ORDER BY award_date DESC').all(student.id)
        };
      },
      classes(includeArchived = false) {
        const filter = includeArchived ? '' : ' AND is_archived = 0';
        return db.prepare(`SELECT DISTINCT class_name FROM students WHERE class_name != ''${filter} ORDER BY class_name`).all().map((r) => r.class_name);
      },
      create(user, input) {
        const data = validateStudent(input);
        checkUnique(data);
        const fields = Object.keys(data);
        const placeholders = fields.map(() => '?').join(', ');
        const result = db.prepare(
          `INSERT INTO students (${fields.join(', ')}, created_at, updated_at) VALUES (${placeholders}, ?, ?)`
        ).run(...fields.map((f) => data[f]), now(), now());
        const id = Number(result.lastInsertRowid);
        logAction(user, '新增学生', '学生', 'student', id, `新增学生 ${data.name}（${data.student_no}）`);
        return id;
      },
      update(user, input) {
        const id = Number(input.id);
        const existing = this.get(id);
        if (!existing) throw new AppError('学生不存在');
        const data = validateStudent(input);
        data.id = id;
        if (input.photo_path === undefined || input.photo_path === null || input.photo_path === '') {
          data.photo_path = existing.photo_path || '';
        }
        checkUnique(data, id);
        const fields = Object.keys(data).filter((f) => f !== 'id');
        const sets = fields.map((f) => `${f} = ?`).join(', ');
        db.prepare(`UPDATE students SET ${sets}, updated_at = ? WHERE id = ?`)
          .run(...fields.map((f) => data[f]), now(), id);
        logAction(user, '编辑学生', '学生', 'student', id, `编辑学生 ${data.name}（${data.student_no}）`);
        return id;
      },
      remove(user, id) {
        const student = this.get(id);
        if (!student) throw new AppError('学生不存在');
        if (student.photo_path && fs.existsSync(student.photo_path)) fs.unlinkSync(student.photo_path);
        db.prepare('DELETE FROM students WHERE id = ?').run(student.id);
        logAction(user, '删除学生', '学生', 'student', student.id, `删除学生 ${student.name}（${student.student_no}）`);
      },
      batchRemove(user, ids) {
        const idList = Array.from(new Set(ids.map(Number))).filter(Boolean);
        if (!idList.length) throw new AppError('请先选择学生');
        transaction(() => {
          idList.forEach((id) => this.remove(user, id));
        });
        logAction(user, '批量删除学生', '学生', 'student', null, `批量删除 ${idList.length} 名学生`);
      },
      archive(user, ids, archived = true) {
        const idList = Array.from(new Set(ids.map(Number))).filter(Boolean);
        if (!idList.length) throw new AppError('请先选择学生');
        transaction(() => {
          idList.forEach((id) => {
            db.prepare('UPDATE students SET is_archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now(), id);
          });
        });
        logAction(user, archived ? '归档学生' : '恢复学生', '学生', 'student', null, `${archived ? '归档' : '恢复'} ${idList.length} 名学生`);
        return idList.length;
      },
      savePhoto(user, id, sourcePath) {
        const student = this.get(id);
        if (!student) throw new AppError('学生不存在');
        if (!fs.existsSync(sourcePath)) throw new AppError('照片文件不存在');
        const ext = path.extname(sourcePath).toLowerCase() || '.jpg';
        const target = path.join(photosDir, `student-${id}-${Date.now()}${ext}`);
        fs.copyFileSync(sourcePath, target);
        if (student.photo_path && fs.existsSync(student.photo_path) && student.photo_path !== target) {
          fs.unlinkSync(student.photo_path);
        }
        db.prepare('UPDATE students SET photo_path = ?, updated_at = ? WHERE id = ?').run(target, now(), id);
        logAction(user, '上传照片', '学生', 'student', id, `更新学生 ${student.name} 的照片`);
        return this.get(id);
      },
      importRows(user, rows) {
        const seenNo = new Set();
        const seenId = new Set();
        const imported = [];
        const skipped = [];
        transaction(() => {
          rows.forEach((row, index) => {
            const line = index + 2;
            const data = {
              ...row,
              student_no: cleanText(row.student_no),
              id_card: cleanText(row.id_card),
              name: cleanText(row.name),
              phone: cleanText(row.phone),
              class_name: cleanText(row.class_name)
            };
            const reasons = [];
            if (!data.name) reasons.push('姓名不能为空');
            if (!data.student_no) reasons.push('学号不能为空');
            if (!data.id_card) reasons.push('身份证号码不能为空');
            if (!data.phone) reasons.push('学生手机号不能为空');
            if (!data.class_name) reasons.push('班级不能为空');
            if (reasons.length) {
              skipped.push({ line, student_no: data.student_no, name: data.name, reason: reasons.join('；'), raw: JSON.stringify(row) });
              return;
            }
            if (seenNo.has(data.student_no) || db.prepare('SELECT id FROM students WHERE student_no = ?').get(data.student_no)) {
              skipped.push({ line, student_no: data.student_no, name: data.name, reason: `学号 ${data.student_no} 重复，已跳过`, raw: JSON.stringify(row) });
              return;
            }
            if (seenId.has(data.id_card) || db.prepare('SELECT id FROM students WHERE id_card = ?').get(data.id_card)) {
              skipped.push({ line, student_no: data.student_no, name: data.name, reason: `身份证 ${data.id_card} 重复，已跳过`, raw: JSON.stringify(row) });
              return;
            }
            seenNo.add(data.student_no);
            seenId.add(data.id_card);
            const id = this.create(user, data);
            if (cleanText(row.photo_path) && fs.existsSync(row.photo_path)) {
              try {
                this.savePhoto(user, id, row.photo_path);
              } catch {
                // 照片路径无效时不影响学生数据导入
              }
            }
            imported.push({ line, student_no: data.student_no, name: data.name });
          });
        });
        logAction(user, '导入学生', 'Excel', 'student', null, `导入 ${imported.length} 条，跳过 ${skipped.length} 条`);
        return { imported, skipped };
      }
    };
  }

  function gradeService() {
    const columns = ['student_id', 'semester', 'course_name', 'score', 'is_failed', 'is_makeup', 'is_retake', 'notes'];
    return {
      listAll(filters = {}) {
        const params = [];
        let where = ' WHERE s.is_archived = 0';
        if (cleanText(filters.keyword)) {
          const like = `%${escapeLike(filters.keyword)}%`;
          where = ' WHERE (s.name LIKE ? ESCAPE \'\\\' OR s.student_no LIKE ? ESCAPE \'\\\' OR s.id_card LIKE ? ESCAPE \'\\\' OR s.political_status LIKE ? ESCAPE \'\\\') AND s.is_archived = 0';
          params.push(like, like, like, like);
        }
        if (cleanText(filters.semester)) {
          where += ' AND g.semester = ?';
          params.push(cleanText(filters.semester));
        }
        return db.prepare(
          `SELECT g.*, s.name AS student_name, s.student_no, s.class_name AS student_class
           FROM semester_grades g JOIN students s ON s.id = g.student_id${where}
           ORDER BY g.semester DESC, s.student_no`
        ).all(...params);
      },
      listByStudent(studentId) {
        return db.prepare('SELECT * FROM semester_grades WHERE student_id = ? ORDER BY semester, course_name').all(Number(studentId));
      },
      get(id) {
        return db.prepare(
          `SELECT g.*, s.name AS student_name, s.student_no FROM semester_grades g JOIN students s ON s.id = g.student_id WHERE g.id = ?`
        ).get(Number(id));
      },
      create(user, input) {
        const studentId = Number(input.student_id);
        if (!db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw new AppError('学生不存在');
        const semester = cleanText(input.semester);
        const courseName = cleanText(input.course_name);
        if (!semester || !courseName) throw new AppError('学期和课程名称不能为空');
        const score = input.score === '' || input.score === null || input.score === undefined ? null : Number(input.score);
        if (score !== null && Number.isNaN(score)) throw new AppError('分数必须是数字');
        if (db.prepare('SELECT id FROM semester_grades WHERE student_id = ? AND semester = ? AND course_name = ?')
          .get(studentId, semester, courseName)) throw new AppError('该学期课程成绩已存在');
        const result = db.prepare(
          `INSERT INTO semester_grades (${columns.join(', ')}, created_at, updated_at) VALUES (${columns.map(() => '?').join(', ')}, ?, ?)`
        ).run(studentId, semester, courseName, score, input.is_failed ? 1 : 0, input.is_makeup ? 1 : 0, input.is_retake ? 1 : 0, cleanText(input.notes), now(), now());
        const id = Number(result.lastInsertRowid);
        logAction(user, '新增成绩', '成绩', 'grade', id, `${semester} ${courseName}`);
        return id;
      },
      update(user, input) {
        const id = Number(input.id);
        const row = db.prepare('SELECT * FROM semester_grades WHERE id = ?').get(id);
        if (!row) throw new AppError('成绩记录不存在');
        const score = input.score === '' || input.score === null || input.score === undefined ? null : Number(input.score);
        if (score !== null && Number.isNaN(score)) throw new AppError('分数必须是数字');
        db.prepare(
          'UPDATE semester_grades SET semester = ?, course_name = ?, score = ?, is_failed = ?, is_makeup = ?, is_retake = ?, notes = ?, updated_at = ? WHERE id = ?'
        ).run(cleanText(input.semester), cleanText(input.course_name), score, input.is_failed ? 1 : 0, input.is_makeup ? 1 : 0, input.is_retake ? 1 : 0, cleanText(input.notes), now(), id);
        logAction(user, '编辑成绩', '成绩', 'grade', id, `${cleanText(input.semester)} ${cleanText(input.course_name)}`);
      },
      remove(user, id) {
        const row = db.prepare('SELECT * FROM semester_grades WHERE id = ?').get(Number(id));
        if (!row) throw new AppError('成绩记录不存在');
        db.prepare('DELETE FROM semester_grades WHERE id = ?').run(row.id);
        logAction(user, '删除成绩', '成绩', 'grade', row.id, `${row.semester} ${row.course_name}`);
      }
    };
  }

  function gradeSummaryService() {
    function toNumber(value) {
      if (value === '' || value === null || value === undefined) return null;
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    }

    function normalize(input, studentId) {
      return {
        student_id: studentId,
        semester: cleanText(input.semester),
        rank: toNumber(input.rank),
        course_count: toNumber(input.course_count),
        failed_course_count: toNumber(input.failed_course_count),
        credits_taken: toNumber(input.credits_taken),
        credits_earned: toNumber(input.credits_earned),
        gpa: toNumber(input.gpa),
        credit_gpa: toNumber(input.credit_gpa),
        avg_gpa: toNumber(input.avg_gpa),
        avg_score: toNumber(input.avg_score),
        admin_class: cleanText(input.admin_class),
        class_name: cleanText(input.class_name)
      };
    }

    return {
      list(filters = {}) {
        const params = [];
        let where = ' WHERE s.is_archived = 0';
        if (cleanText(filters.keyword)) {
          const like = `%${escapeLike(filters.keyword)}%`;
          where = ' WHERE (s.name LIKE ? ESCAPE \'\\\' OR s.student_no LIKE ? ESCAPE \'\\\' OR s.id_card LIKE ? ESCAPE \'\\\' OR s.political_status LIKE ? ESCAPE \'\\\') AND s.is_archived = 0';
          params.push(like, like, like, like);
        }
        if (cleanText(filters.semester)) {
          where += ' AND gs.semester = ?';
          params.push(cleanText(filters.semester));
        }
        return db.prepare(
          `SELECT gs.*, s.name AS student_name, s.student_no, s.id_card, s.political_status
           FROM grade_summaries gs JOIN students s ON s.id = gs.student_id${where}
           ORDER BY gs.semester DESC, gs.rank, s.student_no`
        ).all(...params);
      },
      get(id) {
        return db.prepare(
          `SELECT gs.*, s.name AS student_name, s.student_no FROM grade_summaries gs JOIN students s ON s.id = gs.student_id WHERE gs.id = ?`
        ).get(Number(id));
      },
      create(user, input) {
        const studentId = Number(input.student_id);
        if (!db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw new AppError('学生不存在');
        const data = normalize(input, studentId);
        if (!data.semester) throw new AppError('学期不能为空');
        if (db.prepare('SELECT id FROM grade_summaries WHERE student_id = ? AND semester = ?').get(studentId, data.semester)) {
          throw new AppError('该学生该学期成绩汇总已存在');
        }
        const result = db.prepare(
          `INSERT INTO grade_summaries (student_id, semester, rank, course_count, failed_course_count, credits_taken, credits_earned, gpa, credit_gpa, avg_gpa, avg_score, admin_class, class_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(data.student_id, data.semester, data.rank, data.course_count, data.failed_course_count, data.credits_taken, data.credits_earned, data.gpa, data.credit_gpa, data.avg_gpa, data.avg_score, data.admin_class, data.class_name, now(), now());
        const id = Number(result.lastInsertRowid);
        logAction(user, '新增成绩汇总', '成绩', 'grade_summary', id, `${data.semester}`);
        return id;
      },
      update(user, input) {
        const row = db.prepare('SELECT * FROM grade_summaries WHERE id = ?').get(Number(input.id));
        if (!row) throw new AppError('成绩汇总记录不存在');
        const data = normalize(input, row.student_id);
        if (!data.semester) throw new AppError('学期不能为空');
        const dup = db.prepare('SELECT id FROM grade_summaries WHERE student_id = ? AND semester = ? AND id != ?').get(row.student_id, data.semester, row.id);
        if (dup) throw new AppError('该学生该学期成绩汇总已存在');
        db.prepare(
          `UPDATE grade_summaries SET semester = ?, rank = ?, course_count = ?, failed_course_count = ?, credits_taken = ?, credits_earned = ?, gpa = ?, credit_gpa = ?, avg_gpa = ?, avg_score = ?, admin_class = ?, class_name = ?, updated_at = ? WHERE id = ?`
        ).run(data.semester, data.rank, data.course_count, data.failed_course_count, data.credits_taken, data.credits_earned, data.gpa, data.credit_gpa, data.avg_gpa, data.avg_score, data.admin_class, data.class_name, now(), row.id);
        logAction(user, '编辑成绩汇总', '成绩', 'grade_summary', row.id, data.semester);
      },
      remove(user, id) {
        const row = db.prepare('SELECT * FROM grade_summaries WHERE id = ?').get(Number(id));
        if (!row) throw new AppError('成绩汇总记录不存在');
        db.prepare('DELETE FROM grade_summaries WHERE id = ?').run(row.id);
        logAction(user, '删除成绩汇总', '成绩', 'grade_summary', row.id, row.semester);
      },
      importRows(user, rows, defaultSemester) {
        const imported = [];
        const skipped = [];
        transaction(() => {
          rows.forEach((row, index) => {
            const line = index + 2;
            const studentNo = cleanText(row.student_no);
            if (!studentNo) {
              skipped.push({ line, student_no: '', name: cleanText(row.name), reason: '学号不能为空', raw: JSON.stringify(row) });
              return;
            }
            const student = db.prepare('SELECT id, name, student_no FROM students WHERE student_no = ?').get(studentNo);
            if (!student) {
              skipped.push({ line, student_no: studentNo, name: cleanText(row.name), reason: '学号不存在，无法匹配学生', raw: JSON.stringify(row) });
              return;
            }
            const semester = cleanText(row.semester) || cleanText(defaultSemester);
            if (!semester) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: '学期不能为空', raw: JSON.stringify(row) });
              return;
            }
            if (db.prepare('SELECT id FROM grade_summaries WHERE student_id = ? AND semester = ?').get(student.id, semester)) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: `学期 ${semester} 成绩汇总已存在`, raw: JSON.stringify(row) });
              return;
            }
            const data = normalize({ ...row, semester }, student.id);
            db.prepare(
              `INSERT INTO grade_summaries (student_id, semester, rank, course_count, failed_course_count, credits_taken, credits_earned, gpa, credit_gpa, avg_gpa, avg_score, admin_class, class_name, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(data.student_id, data.semester, data.rank, data.course_count, data.failed_course_count, data.credits_taken, data.credits_earned, data.gpa, data.credit_gpa, data.avg_gpa, data.avg_score, data.admin_class, data.class_name, now(), now());
            imported.push({ line, student_no: studentNo, name: student.name });
          });
        });
        logAction(user, '导入成绩汇总', 'Excel', 'grade_summary', null, `导入 ${imported.length} 条，跳过 ${skipped.length} 条`);
        return { imported, skipped };
      }
    };
  }

  function evaluationService() {
    return {
      listAll(filters = {}) {
        const params = [];
        let where = ' WHERE s.is_archived = 0';
        if (cleanText(filters.keyword)) {
          const like = `%${escapeLike(filters.keyword)}%`;
          where = ' WHERE (s.name LIKE ? ESCAPE \'\\\' OR s.student_no LIKE ? ESCAPE \'\\\' OR s.id_card LIKE ? ESCAPE \'\\\' OR s.political_status LIKE ? ESCAPE \'\\\') AND s.is_archived = 0';
          params.push(like, like, like, like);
        }
        const academicYear = cleanText(filters.academic_year ?? filters.academicYear);
        if (academicYear) {
          where += ' AND e.academic_year = ?';
          params.push(academicYear);
        }
        return db.prepare(
          `SELECT e.*, s.name AS student_name, s.student_no, s.id_card, s.political_status
           FROM comprehensive_evaluations e JOIN students s ON s.id = e.student_id${where}
           ORDER BY e.academic_year DESC, s.student_no`
        ).all(...params);
      },
      listByStudent(studentId) {
        return db.prepare('SELECT * FROM comprehensive_evaluations WHERE student_id = ? ORDER BY academic_year').all(Number(studentId));
      },
      get(id) {
        return db.prepare(
          `SELECT e.*, s.name AS student_name, s.student_no FROM comprehensive_evaluations e JOIN students s ON s.id = e.student_id WHERE e.id = ?`
        ).get(Number(id));
      },
      create(user, input) {
        const studentId = Number(input.student_id);
        if (!db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw new AppError('学生不存在');
        const academicYear = cleanText(input.academic_year);
        if (!academicYear) throw new AppError('学年不能为空');
        const addPoints = Number(input.add_points) || 0;
        const deductPoints = Number(input.deduct_points) || 0;
        const totalScore = input.total_score === '' || input.total_score === null || input.total_score === undefined ? addPoints - deductPoints : Number(input.total_score);
        if (Number.isNaN(totalScore)) throw new AppError('总得分必须是数字');
        if (db.prepare('SELECT id FROM comprehensive_evaluations WHERE student_id = ? AND academic_year = ?')
          .get(studentId, academicYear)) throw new AppError('该学年综测已存在');
        const result = db.prepare(
          'INSERT INTO comprehensive_evaluations (student_id, academic_year, add_points, deduct_points, total_score, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(studentId, academicYear, addPoints, deductPoints, totalScore, cleanText(input.notes), now(), now());
        const id = Number(result.lastInsertRowid);
        logAction(user, '新增综测', '综测', 'evaluation', id, `${academicYear}`);
        return id;
      },
      update(user, input) {
        const row = db.prepare('SELECT * FROM comprehensive_evaluations WHERE id = ?').get(Number(input.id));
        if (!row) throw new AppError('综测记录不存在');
        const addPoints = Number(input.add_points) || 0;
        const deductPoints = Number(input.deduct_points) || 0;
        const totalScore = input.total_score === '' || input.total_score === null || input.total_score === undefined ? addPoints - deductPoints : Number(input.total_score);
        db.prepare(
          'UPDATE comprehensive_evaluations SET academic_year = ?, add_points = ?, deduct_points = ?, total_score = ?, notes = ?, updated_at = ? WHERE id = ?'
        ).run(cleanText(input.academic_year), addPoints, deductPoints, totalScore, cleanText(input.notes), now(), row.id);
        logAction(user, '编辑综测', '综测', 'evaluation', row.id, cleanText(input.academic_year));
      },
      remove(user, id) {
        const row = db.prepare('SELECT * FROM comprehensive_evaluations WHERE id = ?').get(Number(id));
        if (!row) throw new AppError('综测记录不存在');
        db.prepare('DELETE FROM comprehensive_evaluations WHERE id = ?').run(row.id);
        logAction(user, '删除综测', '综测', 'evaluation', row.id, row.academic_year);
      },
      importRows(user, rows, defaultAcademicYear) {
        const imported = [];
        const skipped = [];
        transaction(() => {
          rows.forEach((row, index) => {
            const line = index + 2;
            const studentNo = cleanText(row.student_no);
            if (!studentNo) {
              skipped.push({ line, student_no: '', name: cleanText(row.name), reason: '学号不能为空', raw: JSON.stringify(row) });
              return;
            }
            const student = db.prepare('SELECT id, name, student_no FROM students WHERE student_no = ?').get(studentNo);
            if (!student) {
              skipped.push({ line, student_no: studentNo, name: cleanText(row.name), reason: '学号不存在，无法匹配学生', raw: JSON.stringify(row) });
              return;
            }
            const academicYear = cleanText(row.academic_year) || cleanText(defaultAcademicYear);
            if (!academicYear) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: '学年不能为空', raw: JSON.stringify(row) });
              return;
            }
            if (db.prepare('SELECT id FROM comprehensive_evaluations WHERE student_id = ? AND academic_year = ?').get(student.id, academicYear)) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: `学年 ${academicYear} 综测已存在`, raw: JSON.stringify(row) });
              return;
            }
            const addPoints = Number(row.add_points) || 0;
            const deductPoints = Number(row.deduct_points) || 0;
            const totalScore = row.total_score === '' || row.total_score === null || row.total_score === undefined ? addPoints - deductPoints : Number(row.total_score);
            if (Number.isNaN(totalScore)) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: '总得分必须是数字', raw: JSON.stringify(row) });
              return;
            }
            db.prepare(
              'INSERT INTO comprehensive_evaluations (student_id, academic_year, add_points, deduct_points, total_score, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(student.id, academicYear, addPoints, deductPoints, totalScore, cleanText(row.notes), now(), now());
            imported.push({ line, student_no: studentNo, name: student.name });
          });
        });
        logAction(user, '导入综测', 'Excel', 'evaluation', null, `导入 ${imported.length} 条，跳过 ${skipped.length} 条`);
        return { imported, skipped };
      }
    };
  }

  function attendanceService() {
    function normalize(input) {
      const studentId = Number(input.student_id);
      const semester = cleanText(input.semester);
      const weekNo = Number(input.week_no);
      const startPeriod = Number(input.start_period);
      const endPeriod = Number(input.end_period);
      const attendanceType = cleanText(input.attendance_type);
      const attendanceDate = cleanText(input.attendance_date || input.date);
      if (!db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw new AppError('学生不存在');
      if (!semester) throw new AppError('学期不能为空');
      if (!weekNo || weekNo < 1) throw new AppError('周次必须为正整数');
      if (!startPeriod || !endPeriod || endPeriod < startPeriod) throw new AppError('结束节次不能小于开始节次');
      if (!['旷课', '迟到', '早退'].includes(attendanceType)) throw new AppError('考勤类型无效');
      return {
        student_id: studentId,
        semester,
        week_no: weekNo,
        start_period: startPeriod,
        end_period: endPeriod,
        attendance_type: attendanceType,
        period_count: endPeriod - startPeriod + 1,
        notes: cleanText(input.notes),
        attendance_date: attendanceDate
      };
    }

    return {
      list(filters = {}) {
        const params = [];
        let where = ' WHERE s.is_archived = 0';
        if (filters.student_id) {
          where += ' AND a.student_id = ?';
          params.push(Number(filters.student_id));
        } else if (cleanText(filters.keyword)) {
          const like = `%${escapeLike(filters.keyword)}%`;
          where += ' AND (s.name LIKE ? ESCAPE \'\\\' OR s.student_no LIKE ? ESCAPE \'\\\' OR s.id_card LIKE ? ESCAPE \'\\\' OR s.political_status LIKE ? ESCAPE \'\\\')';
          params.push(like, like, like, like);
        }
        if (cleanText(filters.semester)) {
          where += ' AND a.semester = ?';
          params.push(cleanText(filters.semester));
        }
        return db.prepare(
          `SELECT a.*, s.name AS student_name, s.student_no, s.class_name FROM attendance_records a JOIN students s ON s.id = a.student_id${where} ORDER BY a.semester DESC, a.week_no DESC, a.start_period`
        ).all(...params);
      },
      stats(studentId, semester) {
        const params = [Number(studentId)];
        let where = 'WHERE student_id = ?';
        if (semester) {
          where += ' AND semester = ?';
          params.push(semester);
        }
        const row = db.prepare(
          `SELECT COALESCE(SUM(CASE WHEN attendance_type = '旷课' THEN period_count END), 0) AS absent_periods,
                  COALESCE(SUM(CASE WHEN attendance_type = '迟到' THEN 1 END), 0) AS late_count,
                  COALESCE(SUM(CASE WHEN attendance_type = '早退' THEN 1 END), 0) AS early_count
           FROM attendance_records ${where}`
        ).get(...params);
        const equivalent = row.absent_periods + Math.floor((row.late_count + row.early_count) / 3);
        return { ...row, equivalent_absent: equivalent };
      },
      get(id) {
        return db.prepare(
          `SELECT a.*, s.name AS student_name, s.student_no FROM attendance_records a JOIN students s ON s.id = a.student_id WHERE a.id = ?`
        ).get(Number(id));
      },
      cumulativeStats(semester) {
        const params = [];
        let where = 'WHERE s.is_archived = 0';
        if (cleanText(semester)) {
          where += ' AND a.semester = ?';
          params.push(cleanText(semester));
        }
        const rows = db.prepare(
          `SELECT s.id AS student_id, s.name AS student_name, s.student_no, s.class_name,
                  COALESCE(SUM(CASE WHEN a.attendance_type = '旷课' THEN a.period_count END), 0) AS absent_periods,
                  COALESCE(SUM(CASE WHEN a.attendance_type = '迟到' THEN 1 END), 0) AS late_count,
                  COALESCE(SUM(CASE WHEN a.attendance_type = '早退' THEN 1 END), 0) AS early_count
           FROM attendance_records a JOIN students s ON s.id = a.student_id
           ${where}
           GROUP BY s.id, s.name, s.student_no, s.class_name
           ORDER BY absent_periods DESC, s.student_no`
        ).all(...params);
        return rows.map((row) => ({ ...row, equivalent_absent: row.absent_periods + Math.floor((row.late_count + row.early_count) / 3) }));
      },
      create(user, input) {
        const data = normalize(input);
        const result = db.prepare(
          'INSERT INTO attendance_records (student_id, semester, week_no, start_period, end_period, attendance_type, period_count, notes, attendance_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(data.student_id, data.semester, data.week_no, data.start_period, data.end_period, data.attendance_type, data.period_count, data.notes, data.attendance_date || null, now(), now());
        const id = Number(result.lastInsertRowid);
        logAction(user, '新增考勤', '考勤', 'attendance', id, `${data.semester} 第${data.week_no}周 ${data.start_period}-${data.end_period}节 ${data.attendance_type}`);
        return id;
      },
      update(user, input) {
        const row = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(Number(input.id));
        if (!row) throw new AppError('考勤记录不存在');
        const data = normalize(input);
        db.prepare(
          'UPDATE attendance_records SET student_id = ?, semester = ?, week_no = ?, start_period = ?, end_period = ?, attendance_type = ?, period_count = ?, notes = ?, attendance_date = ?, updated_at = ? WHERE id = ?'
        ).run(data.student_id, data.semester, data.week_no, data.start_period, data.end_period, data.attendance_type, data.period_count, data.notes, data.attendance_date || null, now(), row.id);
        logAction(user, '编辑考勤', '考勤', 'attendance', row.id, `${data.semester} 第${data.week_no}周`);
      },
      remove(user, id) {
        const row = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(Number(id));
        if (!row) throw new AppError('考勤记录不存在');
        db.prepare('DELETE FROM attendance_records WHERE id = ?').run(row.id);
        logAction(user, '删除考勤', '考勤', 'attendance', row.id, `${row.semester} 第${row.week_no}周`);
      },
      batchRemove(user, ids) {
        const idList = Array.from(new Set(ids.map(Number))).filter(Boolean);
        if (!idList.length) throw new AppError('请先选择考勤记录');
        transaction(() => {
          idList.forEach((id) => this.remove(user, id));
        });
        logAction(user, '批量删除考勤', '考勤', 'attendance', null, `批量删除 ${idList.length} 条考勤记录`);
        return idList.length;
      },
      importRows(user, rows, defaultSemester) {
        const imported = [];
        const skipped = [];
        transaction(() => {
          rows.forEach((row, index) => {
            const line = index + 2;
            const studentNo = cleanText(row.student_no);
            if (!studentNo) {
              skipped.push({ line, student_no: '', name: cleanText(row.name), reason: '学号不能为空', raw: JSON.stringify(row) });
              return;
            }
            const student = db.prepare('SELECT id, name, student_no FROM students WHERE student_no = ?').get(studentNo);
            if (!student) {
              skipped.push({ line, student_no: studentNo, name: cleanText(row.name), reason: '学号不存在，无法匹配学生', raw: JSON.stringify(row) });
              return;
            }
            const semester = cleanText(row.semester) || cleanText(defaultSemester);
            const weekNo = Number(row.week_no);
            const startPeriod = Number(row.start_period);
            const endPeriod = Number(row.end_period);
            const attendanceType = cleanText(row.attendance_type);
            const attendanceDate = cleanText(row.attendance_date || row.date);
            const reasons = [];
            if (!semester) reasons.push('学期不能为空');
            if (!weekNo || weekNo < 1) reasons.push('周次必须为正整数');
            if (!startPeriod || !endPeriod || endPeriod < startPeriod) reasons.push('节次范围无效');
            if (!['旷课', '迟到', '早退'].includes(attendanceType)) reasons.push('考勤类型无效');
            if (reasons.length) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: reasons.join('；'), raw: JSON.stringify(row) });
              return;
            }
            const duplicate = db.prepare(
              'SELECT id FROM attendance_records WHERE student_id = ? AND semester = ? AND week_no = ? AND start_period = ? AND end_period = ? AND attendance_type = ? AND (attendance_date = ? OR (attendance_date IS NULL AND ? IS NULL))'
            ).get(student.id, semester, weekNo, startPeriod, endPeriod, attendanceType, attendanceDate || null, attendanceDate || null);
            if (duplicate) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: '相同考勤记录已存在', raw: JSON.stringify(row) });
              return;
            }
            db.prepare(
              'INSERT INTO attendance_records (student_id, semester, week_no, start_period, end_period, attendance_type, period_count, notes, attendance_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(student.id, semester, weekNo, startPeriod, endPeriod, attendanceType, endPeriod - startPeriod + 1, cleanText(row.notes), attendanceDate || null, now(), now());
            imported.push({ line, student_no: studentNo, name: student.name });
          });
        });
        logAction(user, '导入考勤', 'Excel', 'attendance', null, `导入 ${imported.length} 条，跳过 ${skipped.length} 条`);
        return { imported, skipped };
      }
    };
  }

  function recordService(type) {
    const table = type === 'discipline' ? 'disciplinary_records' : 'reward_records';
    const label = type === 'discipline' ? '处分' : '奖励';
    return {
      get(id) {
        return db.prepare(
          `SELECT r.*, s.name AS student_name, s.student_no FROM ${table} r JOIN students s ON s.id = r.student_id WHERE r.id = ?`
        ).get(Number(id));
      },
      list(filters = {}) {
        const params = [];
        let where = ' WHERE s.is_archived = 0';
        if (filters.student_id) {
          where += ' AND r.student_id = ?';
          params.push(Number(filters.student_id));
        } else if (cleanText(filters.keyword)) {
          const like = `%${escapeLike(filters.keyword)}%`;
          where += ' AND (s.name LIKE ? ESCAPE \'\\\' OR s.student_no LIKE ? ESCAPE \'\\\' OR s.id_card LIKE ? ESCAPE \'\\\' OR s.political_status LIKE ? ESCAPE \'\\\')';
          params.push(like, like, like, like);
        }
        const punishmentType = cleanText(filters.punishment_type ?? filters.punishmentType);
        const status = cleanText(filters.status ?? filters.status);
        const awardName = cleanText(filters.award_name ?? filters.awardName);
        if (type === 'discipline') {
          if (punishmentType) {
            where += ' AND r.punishment_type = ?';
            params.push(punishmentType);
          }
          if (status) {
            where += ' AND r.status = ?';
            params.push(status);
          }
        } else if (awardName) {
          where += ' AND r.award_name LIKE ? ESCAPE \'\\\'';
          params.push(`%${escapeLike(awardName)}%`);
        }
        const order = type === 'discipline' ? 'r.punishment_date DESC' : 'r.award_date DESC';
        return db.prepare(
          `SELECT r.*, s.name AS student_name, s.student_no, s.class_name FROM ${table} r JOIN students s ON s.id = r.student_id${where} ORDER BY ${order}`
        ).all(...params);
      },
      importRows(user, rows) {
        const imported = [];
        const skipped = [];
        transaction(() => {
          rows.forEach((row, index) => {
            const line = index + 2;
            const studentNo = cleanText(row.student_no);
            if (!studentNo) {
              skipped.push({ line, student_no: '', name: cleanText(row.name), reason: '学号不能为空' });
              return;
            }
            const student = db.prepare('SELECT id, name, student_no FROM students WHERE student_no = ?').get(studentNo);
            if (!student) {
              skipped.push({ line, student_no: studentNo, name: cleanText(row.name), reason: '学号不存在，无法匹配学生' });
              return;
            }
            let duplicate = false;
            if (type === 'discipline') {
              const reason = cleanText(row.reason);
              const punishmentType = cleanText(row.punishment_type);
              const punishmentDate = cleanText(row.punishment_date);
              const status = cleanText(row.status) || '处分中';
              if (!reason || !punishmentType || !punishmentDate) {
                skipped.push({ line, student_no: studentNo, name: student.name, reason: '处分原因、类型、时间不能为空', raw: JSON.stringify(row) });
                return;
              }
              if (!['处分中', '撤销流程中', '已撤销'].includes(status)) {
                skipped.push({ line, student_no: studentNo, name: student.name, reason: '处分状态无效', raw: JSON.stringify(row) });
                return;
              }
              duplicate = Boolean(db.prepare(
                'SELECT id FROM disciplinary_records WHERE student_id = ? AND reason = ? AND punishment_type = ? AND punishment_date = ? AND status = ?'
              ).get(student.id, reason, punishmentType, punishmentDate, status));
            } else {
              const awardName = cleanText(row.award_name);
              const awardDate = cleanText(row.award_date);
              if (!awardName || !awardDate) {
                skipped.push({ line, student_no: studentNo, name: student.name, reason: '奖项名称、获奖时间不能为空', raw: JSON.stringify(row) });
                return;
              }
              duplicate = Boolean(db.prepare(
                'SELECT id FROM reward_records WHERE student_id = ? AND award_name = ? AND issuer = ? AND award_date = ?'
              ).get(student.id, awardName, cleanText(row.issuer), awardDate));
            }
            if (duplicate) {
              skipped.push({ line, student_no: studentNo, name: student.name, reason: '相同记录已存在', raw: JSON.stringify(row) });
              return;
            }
            this.create(user, { student_id: student.id, ...row });
            imported.push({ line, student_no: studentNo, name: student.name });
          });
        });
        logAction(user, `导入${label}`, 'Excel', type, null, `导入 ${imported.length} 条，跳过 ${skipped.length} 条`);
        return { imported, skipped };
      },
      create(user, input) {
        const studentId = Number(input.student_id);
        if (!db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw new AppError('学生不存在');
        if (type === 'discipline') {
          if (!cleanText(input.reason)) throw new AppError('处分原因不能为空');
          if (!cleanText(input.punishment_type)) throw new AppError('处分类型不能为空');
          if (!cleanText(input.punishment_date)) throw new AppError('处分时间不能为空');
          const status = cleanText(input.status) || '处分中';
          if (!['处分中', '撤销流程中', '已撤销'].includes(status)) throw new AppError('处分状态无效');
          const result = db.prepare(
            'INSERT INTO disciplinary_records (student_id, reason, punishment_type, punishment_date, status, revoke_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(studentId, cleanText(input.reason), cleanText(input.punishment_type), cleanText(input.punishment_date), status, cleanText(input.revoke_date) || null, cleanText(input.notes), now(), now());
          const id = Number(result.lastInsertRowid);
          logAction(user, `新增${label}`, label, type, id, cleanText(input.reason));
          return id;
        }
        if (!cleanText(input.award_name)) throw new AppError('奖项名称不能为空');
        if (!cleanText(input.award_date)) throw new AppError('获奖时间不能为空');
        const result = db.prepare(
          'INSERT INTO reward_records (student_id, activity, award_name, issuer, award_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(studentId, cleanText(input.activity), cleanText(input.award_name), cleanText(input.issuer), cleanText(input.award_date), cleanText(input.notes), now(), now());
        const id = Number(result.lastInsertRowid);
        logAction(user, `新增${label}`, label, type, id, cleanText(input.award_name));
        return id;
      },
      update(user, input) {
        const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(input.id));
        if (!row) throw new AppError(`${label}记录不存在`);
        const studentId = Number(input.student_id);
        if (!db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw new AppError('学生不存在');
        if (type === 'discipline') {
          const status = cleanText(input.status) || row.status;
          if (!['处分中', '撤销流程中', '已撤销'].includes(status)) throw new AppError('处分状态无效');
          db.prepare(
            'UPDATE disciplinary_records SET student_id = ?, reason = ?, punishment_type = ?, punishment_date = ?, status = ?, revoke_date = ?, notes = ?, updated_at = ? WHERE id = ?'
          ).run(studentId, cleanText(input.reason), cleanText(input.punishment_type), cleanText(input.punishment_date), status, cleanText(input.revoke_date) || null, cleanText(input.notes), now(), row.id);
        } else {
          const activity = cleanText(input.activity) || row.activity || '';
          db.prepare(
            'UPDATE reward_records SET student_id = ?, activity = ?, award_name = ?, issuer = ?, award_date = ?, notes = ?, updated_at = ? WHERE id = ?'
          ).run(studentId, activity, cleanText(input.award_name), cleanText(input.issuer), cleanText(input.award_date), cleanText(input.notes), now(), row.id);
        }
        logAction(user, `编辑${label}`, label, type, row.id, `${row.student_id}`);
      },
      remove(user, id) {
        const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
        if (!row) throw new AppError(`${label}记录不存在`);
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
        logAction(user, `删除${label}`, label, type, row.id, '');
      }
    };
  }

  function dashboardService() {
    return {
      stats() {
        const statuses = db.prepare('SELECT label FROM enrollment_statuses WHERE counts_to_total = 1').all().map((r) => r.label);
        const totalAll = db.prepare('SELECT COUNT(*) AS c FROM students WHERE is_archived = 0').get().c;
        const totalCounted = statuses.length
          ? db.prepare(`SELECT COUNT(*) AS c FROM students WHERE is_archived = 0 AND enrollment_status IN (${statuses.map(() => '?').join(',')})`).get(...statuses).c
          : 0;
        const classCounts = db.prepare('SELECT class_name AS label, COUNT(*) AS value FROM students WHERE is_archived = 0 GROUP BY class_name ORDER BY value DESC, class_name').all();
        const politicalCounts = db.prepare('SELECT COALESCE(NULLIF(political_status, \'\'), \'未填写\') AS label, COUNT(*) AS value FROM students WHERE is_archived = 0 GROUP BY label ORDER BY value DESC').all();
        const genderCounts = db.prepare('SELECT COALESCE(NULLIF(gender, \'\'), \'未填写\') AS label, COUNT(*) AS value FROM students WHERE is_archived = 0 GROUP BY label ORDER BY value DESC').all();
        const enrollmentCounts = db.prepare('SELECT COALESCE(NULLIF(enrollment_status, \'\'), \'未填写\') AS label, COUNT(*) AS value FROM students WHERE is_archived = 0 GROUP BY label ORDER BY value DESC').all();
        const activeCase = statuses.length
          ? `SUM(CASE WHEN enrollment_status IN (${statuses.map(() => '?').join(',')}) THEN 1 ELSE 0 END)`
          : '0';
        const classBoard = statuses.length
          ? db.prepare(`SELECT class_name AS label, COUNT(*) AS value, COALESCE(${activeCase}, 0) AS active_value FROM students WHERE is_archived = 0 GROUP BY class_name ORDER BY value DESC, class_name`).all(...statuses)
          : db.prepare('SELECT class_name AS label, COUNT(*) AS value, 0 AS active_value FROM students WHERE is_archived = 0 GROUP BY class_name ORDER BY value DESC, class_name').all();
        return {
          total_counted: totalCounted,
          total_all: totalAll,
          class_counts: classCounts,
          class_board: classBoard,
          political_counts: politicalCounts,
          gender_counts: genderCounts,
          enrollment_counts: enrollmentCounts
        };
      }
    };
  }

  function logService() {
    return {
      list(filters = {}) {
        const where = [];
        const params = [];
        if (cleanText(filters.keyword)) {
          const like = `%${escapeLike(filters.keyword)}%`;
          where.push('(username LIKE ? ESCAPE \'\\\' OR action LIKE ? ESCAPE \'\\\' OR module LIKE ? ESCAPE \'\\\' OR detail LIKE ? ESCAPE \'\\\')');
          params.push(like, like, like, like);
        }
        if (cleanText(filters.action)) {
          where.push('action = ?');
          params.push(cleanText(filters.action));
        }
        const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        const page = Math.max(1, Number(filters.page) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 50));
        const total = db.prepare(`SELECT COUNT(*) AS c FROM operation_logs${whereSql}`).get(...params).c;
        const items = db.prepare(`SELECT * FROM operation_logs${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
          .all(...params, pageSize, (page - 1) * pageSize);
        return { items, total, page, pageSize };
      }
    };
  }

  function settingsService() {
    return {
      listStatuses() {
        return db.prepare('SELECT * FROM enrollment_statuses ORDER BY sort_order, id').all()
          .map((row) => ({ ...row, counts_to_total: Boolean(row.counts_to_total) }));
      },
      createStatus(user, input) {
        const label = cleanText(input.label);
        if (!label) throw new AppError('状态名称不能为空');
        if (db.prepare('SELECT id FROM enrollment_statuses WHERE label = ?').get(label)) throw new AppError('状态名称已存在');
        const sortOrder = Number(input.sort_order) || (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM enrollment_statuses').get().n);
        const result = db.prepare(
          'INSERT INTO enrollment_statuses (label, counts_to_total, sort_order, created_at) VALUES (?, ?, ?, ?)'
        ).run(label, input.counts_to_total ? 1 : 0, sortOrder, now());
        logAction(user, '新增学籍状态', '设置', 'enrollment_status', Number(result.lastInsertRowid), label);
        return Number(result.lastInsertRowid);
      },
      updateStatus(user, input) {
        const row = db.prepare('SELECT * FROM enrollment_statuses WHERE id = ?').get(Number(input.id));
        if (!row) throw new AppError('状态不存在');
        const label = cleanText(input.label);
        if (!label) throw new AppError('状态名称不能为空');
        const dup = db.prepare('SELECT id FROM enrollment_statuses WHERE label = ? AND id != ?').get(label, row.id);
        if (dup) throw new AppError('状态名称已存在');
        db.prepare('UPDATE enrollment_statuses SET label = ?, counts_to_total = ?, sort_order = ? WHERE id = ?')
          .run(label, input.counts_to_total ? 1 : 0, Number(input.sort_order) || row.sort_order, row.id);
        logAction(user, '编辑学籍状态', '设置', 'enrollment_status', row.id, label);
      },
      removeStatus(user, id) {
        const row = db.prepare('SELECT * FROM enrollment_statuses WHERE id = ?').get(Number(id));
        if (!row) throw new AppError('状态不存在');
        const used = db.prepare('SELECT COUNT(*) AS c FROM students WHERE enrollment_status = ?').get(row.label).c;
        if (used) throw new AppError(`该状态正被 ${used} 名学生使用，不能删除`);
        db.prepare('DELETE FROM enrollment_statuses WHERE id = ?').run(row.id);
        logAction(user, '删除学籍状态', '设置', 'enrollment_status', row.id, row.label);
      }
    };
  }

  return {
    logAction,
    auth: authService(),
    users: userService(),
    students: studentService(),
    grades: gradeService(),
    gradeSummaries: gradeSummaryService(),
    evaluations: evaluationService(),
    attendance: attendanceService(),
    discipline: recordService('discipline'),
    rewards: recordService('reward'),
    dashboard: dashboardService(),
    logs: logService(),
    settings: settingsService()
  };
}

module.exports = { createServices, AppError, validateStudent, cleanText };
