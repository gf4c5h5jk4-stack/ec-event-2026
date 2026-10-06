import { createClient } from '@libsql/client/web';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const body = req.body ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) : {};

  try {
    // 1. حالة النظام
    if (action === 'get_state') {
      const rs = await db.execute('SELECT * FROM system_state WHERE id = 1');
      const state = rs.rows[0] || { current_mode: 'WELCOME' };
      if (state.raffle_winners && typeof state.raffle_winners === 'string') {
        state.raffle_winners = JSON.parse(state.raffle_winners);
      }
      return res.status(200).json(state);
    }

    if (action === 'set_mode') {
      await db.execute({
        sql: 'UPDATE system_state SET current_mode = ?, active_question_id = NULL WHERE id = 1',
        args: [body.mode]
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'launch_question') {
      await db.execute({
        sql: 'UPDATE system_state SET current_mode = \'QUESTION\', active_question_id = ?, question_duration = ?, question_expires_at = ? WHERE id = 1',
        args: [body.question_id, body.duration, body.expires_at]
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'trigger_bonus') {
      await db.execute({
        sql: 'UPDATE system_state SET current_mode = \'FLASH_BONUS\', active_bonus_id = ?, bonus_expires_at = ? WHERE id = 1',
        args: [body.bonus_id, body.expires_at]
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'prepare_raffle') {
      await db.execute('UPDATE system_state SET current_mode = \'RAFFLE\', raffle_winners = NULL WHERE id = 1');
      return res.status(200).json({ success: true });
    }

    if (action === 'set_raffle_winners') {
      await db.execute({
        sql: 'UPDATE system_state SET current_mode = \'RAFFLE\', raffle_winners = ? WHERE id = 1',
        args: [JSON.stringify(body.winners)]
      });
      return res.status(200).json({ success: true });
    }

    // 2. بيانات شاشة العرض
    if (action === 'get_display_data') {
      const sRs = await db.execute('SELECT * FROM system_state WHERE id = 1');
      const pRs = await db.execute('SELECT COUNT(*) as count, SUM(score) as total_score FROM participants');
      const state = sRs.rows[0] || { current_mode: 'WELCOME' };
      if (state.raffle_winners && typeof state.raffle_winners === 'string') {
        state.raffle_winners = JSON.parse(state.raffle_winners);
      }
      return res.status(200).json({
        state,
        statParticipants: pRs.rows[0]?.count || 0,
        statTotalScore: pRs.rows[0]?.total_score || 0
      });
    }

    // 3. الأسئلة
    if (action === 'get_questions') {
      const rs = await db.execute('SELECT * FROM questions');
      const questions = {};
      rs.rows.forEach(r => {
        questions[r.id] = { ...r, options: JSON.parse(r.options) };
      });
      return res.status(200).json(questions);
    }

    if (action === 'get_question') {
      const rs = await db.execute({ sql: 'SELECT * FROM questions WHERE id = ?', args: [req.query.id] });
      if (!rs.rows[0]) return res.status(404).json({ error: 'Not found' });
      const q = rs.rows[0];
      q.options = JSON.parse(q.options);
      return res.status(200).json(q);
    }

    if (action === 'add_question') {
      await db.execute({
        sql: 'INSERT INTO questions (id, text, duration, options, correct) VALUES (?, ?, ?, ?, ?)',
        args: [body.id, body.text, body.duration, JSON.stringify(body.options), body.correct]
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_question') {
      await db.execute({ sql: 'DELETE FROM questions WHERE id = ?', args: [body.id] });
      return res.status(200).json({ success: true });
    }

    // 4. إدارة الطلاب
    if (action === 'get_participants') {
      const rs = await db.execute('SELECT * FROM participants ORDER BY score DESC, registered_at ASC');
      const participants = {};
      rs.rows.forEach(r => { participants[r.code] = r; });
      return res.status(200).json(participants);
    }

    if (action === 'get_student_data') {
      const rs = await db.execute({ sql: 'SELECT * FROM participants WHERE code = ?', args: [req.query.code] });
      if (!rs.rows[0]) return res.status(404).json({ error: 'Not found' });
      const p = rs.rows[0];
      p.answered_questions = JSON.parse(p.answered_questions || '[]');
      p.claimed_bonuses = JSON.parse(p.claimed_bonuses || '[]');
      return res.status(200).json(p);
    }

    if (action === 'lookup_student') {
      const q = req.query.query;
      const rs = await db.execute({ sql: 'SELECT * FROM participants WHERE code = ? OR student_id = ?', args: [q, q] });
      if (!rs.rows[0]) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(rs.rows[0]);
    }

    if (action === 'register') {
      const { name, student_id, telegram } = body;
      const check = await db.execute({ sql: 'SELECT * FROM participants WHERE student_id = ?', args: [student_id] });
      if (check.rows[0]) {
        return res.status(200).json({ code: check.rows[0].code, isExisting: true });
      }

      let code;
      while (true) {
        code = Math.floor(1000 + Math.random() * 9000).toString();
        const codeCheck = await db.execute({ sql: 'SELECT code FROM participants WHERE code = ?', args: [code] });
        if (codeCheck.rows.length === 0) break;
      }

      await db.execute({
        sql: 'INSERT INTO participants (code, name, student_id, telegram, score, registered_at) VALUES (?, ?, ?, ?, 1, ?)',
        args: [code, name, student_id, telegram || '', Date.now()]
      });

      return res.status(200).json({ code, isExisting: false });
    }

    if (action === 'add_manual_point') {
      await db.execute({ sql: 'UPDATE participants SET score = score + 1 WHERE code = ?', args: [body.code] });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_participant') {
      await db.execute({ sql: 'DELETE FROM participants WHERE code = ?', args: [body.code] });
      return res.status(200).json({ success: true });
    }

    if (action === 'reset_participants') {
      await db.execute('DELETE FROM participants');
      return res.status(200).json({ success: true });
    }

    if (action === 'submit_answer') {
      const { code, question_id, selected_idx } = body;
      const qRs = await db.execute({ sql: 'SELECT * FROM questions WHERE id = ?', args: [question_id] });
      const pRs = await db.execute({ sql: 'SELECT * FROM participants WHERE code = ?', args: [code] });
      if (!qRs.rows[0] || !pRs.rows[0]) return res.status(400).json({ error: 'Invalid' });

      const q = qRs.rows[0];
      const p = pRs.rows[0];
      const answered = JSON.parse(p.answered_questions || '[]');

      if (answered.includes(question_id)) {
        return res.status(400).json({ error: 'already_answered' });
      }

      answered.push(question_id);
      const isCorrect = (selected_idx === q.correct);
      const newScore = isCorrect ? p.score + 1 : p.score;

      await db.execute({
        sql: 'UPDATE participants SET score = ?, answered_questions = ? WHERE code = ?',
        args: [newScore, JSON.stringify(answered), code]
      });

      return res.status(200).json({ success: true, isCorrect, newScore });
    }

    if (action === 'claim_bonus') {
      const { code, bonus_id } = body;
      const sRs = await db.execute('SELECT * FROM system_state WHERE id = 1');
      const pRs = await db.execute({ sql: 'SELECT * FROM participants WHERE code = ?', args: [code] });
      const state = sRs.rows[0];
      const p = pRs.rows[0];

      if (state.current_mode !== 'FLASH_BONUS' || state.active_bonus_id !== bonus_id || Date.now() > state.bonus_expires_at) {
        return res.status(400).json({ error: 'expired' });
      }

      const claimed = JSON.parse(p.claimed_bonuses || '[]');
      if (claimed.includes(bonus_id)) {
        return res.status(400).json({ error: 'already_claimed' });
      }

      claimed.push(bonus_id);
      await db.execute({
        sql: 'UPDATE participants SET score = score + 1, claimed_bonuses = ? WHERE code = ?',
        args: [JSON.stringify(claimed), code]
      });

      return res.status(200).json({ success: true });
    }

    // 5. أكواد المقاعد
    if (action === 'get_chairs') {
      const rs = await db.execute('SELECT * FROM chair_codes ORDER BY number ASC');
      const chairs = {};
      rs.rows.forEach(r => { chairs[r.id] = r; });
      return res.status(200).json(chairs);
    }

    if (action === 'generate_chairs') {
      const count = parseInt(body.count) || 10;
      await db.execute('DELETE FROM chair_codes');
      for (let i = 1; i <= count; i++) {
        const id = `CARD_${Date.now().toString().slice(-4)}_${i}`;
        const token = 'CHR-' + Math.floor(100000 + Math.random() * 900000);
        await db.execute({
          sql: 'INSERT INTO chair_codes (id, number, token, used) VALUES (?, ?, ?, 0)',
          args: [id, i, token]
        });
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'claim_chair') {
      const { chair_id, student_input } = body;
      const cRs = await db.execute({ sql: 'SELECT * FROM chair_codes WHERE id = ?', args: [chair_id] });
      if (!cRs.rows[0]) return res.status(404).json({ error: 'not_found' });
      if (cRs.rows[0].used) return res.status(400).json({ error: 'already_used', data: cRs.rows[0] });

      const pRs = await db.execute({
        sql: 'SELECT * FROM participants WHERE code = ? OR student_id = ?',
        args: [student_input, student_input]
      });
      if (!pRs.rows[0]) return res.status(404).json({ error: 'student_not_found' });

      const student = pRs.rows[0];

      await db.execute({
        sql: 'UPDATE chair_codes SET used = 1, claimed_by = ?, student_name = ?, claimed_at = ? WHERE id = ? AND used = 0',
        args: [student.code, student.name, Date.now(), chair_id]
      });

      await db.execute({
        sql: 'UPDATE participants SET score = score + 1 WHERE code = ?',
        args: [student.code]
      });

      return res.status(200).json({ success: true, name: student.name, code: student.code, score: student.score + 1 });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
