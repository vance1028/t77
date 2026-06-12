'use strict';

const { pool } = require('../db');
const { hashPassword } = require('../utils/password');

const WARN_WARRANTY_DAYS = 30;
const WARN_LIFE_MONTHS = 6;
const WARN_MAINTAIN_DAYS = 7;

function daysDiff(d1, d2) {
  const ms = new Date(d2) - new Date(d1);
  return Math.floor(ms / 86400000);
}

function addYears(dateStr, years) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function computeLifecycleFlags(eq) {
  const now = today();
  const flags = {
    inWarranty: false,
    warrantyExpiring: false,
    warrantyExpired: false,
    maintainDue: false,
    maintainOverdue: false,
    lifeWarning: false,
    lifeEnded: false,
    lifeUsedRatio: 0,
    alertLevel: 'NONE',
    alerts: [],
  };
  if (eq.warrantyEndDate) {
    const dw = daysDiff(now, eq.warrantyEndDate);
    if (dw < 0) {
      flags.warrantyExpired = true;
      flags.alerts.push('已出保');
    } else if (dw <= WARN_WARRANTY_DAYS) {
      flags.inWarranty = true;
      flags.warrantyExpiring = true;
      flags.alerts.push(`即将出保（剩${dw}天）`);
    } else {
      flags.inWarranty = true;
    }
  }
  const baseDate = eq.commissionDate || eq.installDate;
  if (baseDate && eq.designLifeYears) {
    const endDate = addYears(baseDate, eq.designLifeYears);
    const dl = daysDiff(now, endDate);
    const totalDays = eq.designLifeYears * 365;
    const used = daysDiff(baseDate, now);
    flags.lifeUsedRatio = Math.max(0, Math.min(1, totalDays > 0 ? used / totalDays : 0));
    if (dl < 0) {
      flags.lifeEnded = true;
      flags.alerts.push('超过设计寿命');
    } else {
      const monthsLeft = Math.ceil(dl / 30);
      if (monthsLeft <= WARN_LIFE_MONTHS) {
        flags.lifeWarning = true;
        flags.alerts.push(`临近设计寿命（剩${monthsLeft}个月）`);
      }
    }
  }
  if (eq.lastMaintainDate && eq.maintainCycleDays) {
    const next = new Date(eq.lastMaintainDate);
    next.setDate(next.getDate() + eq.maintainCycleDays);
    const dm = daysDiff(now, next.toISOString().slice(0, 10));
    if (dm < 0) {
      flags.maintainOverdue = true;
      flags.alerts.push(`维护超期${-dm}天`);
    } else if (dm <= WARN_MAINTAIN_DAYS) {
      flags.maintainDue = true;
      flags.alerts.push(`临近维护（剩${dm}天）`);
    }
  } else if (baseDate && eq.maintainCycleDays) {
    flags.maintainOverdue = true;
    flags.alerts.push('从未维护过');
  }
  if (flags.lifeEnded) flags.alertLevel = 'DANGER';
  else if (flags.warrantyExpired || flags.maintainOverdue) flags.alertLevel = 'WARNING';
  else if (flags.alerts.length) flags.alertLevel = 'INFO';
  return flags;
}

/* ----------------------------- 映射 ----------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    name: r.name,
    role: r.role,
    department: r.department,
    status: r.status,
    createdAt: r.created_at,
  };
}

function mapUserWithHash(r) {
  if (!r) return null;
  return { ...mapUser(r), passwordHash: r.password_hash };
}

function mapProject(r) {
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    protectionLevel: r.protection_level,
    areaSqm: Number(r.area_sqm),
    address: r.address,
    district: r.district,
    peacetimeUse: r.peacetime_use,
    status: r.status,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapEquipment(r) {
  if (!r) return null;
  const eq = {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    category: r.category,
    model: r.model,
    serialNo: r.serial_no,
    installDate: r.install_date,
    commissionDate: r.commission_date,
    designLifeYears: r.design_life_years,
    warrantyEndDate: r.warranty_end_date,
    lastMaintainDate: r.last_maintain_date,
    maintainCycleDays: r.maintain_cycle_days,
    status: r.status,
    remark: r.remark,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  return { ...eq, lifecycle: computeLifecycleFlags(eq) };
}

function mapEquipmentHistory(r) {
  if (!r) return null;
  return {
    id: r.id,
    equipmentId: r.equipment_id,
    eventType: r.event_type,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    eventDate: r.event_date,
    operatorId: r.operator_id,
    operatorName: r.operator_name || undefined,
    description: r.description,
    cost: Number(r.cost),
    referenceId: r.reference_id,
    createdAt: r.created_at,
  };
}

function mapSparePart(r) {
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    specification: r.specification,
    unit: r.unit,
    stockQty: r.stock_qty,
    safetyStock: r.safety_stock,
    unitPrice: Number(r.unit_price),
    location: r.location,
    remark: r.remark,
    stockStatus: r.stock_qty <= 0 ? 'OUT_OF_STOCK' : r.stock_qty < r.safety_stock ? 'LOW_STOCK' : 'NORMAL',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapSparePartMovement(r) {
  if (!r) return null;
  return {
    id: r.id,
    sparePartId: r.spare_part_id,
    sparePartName: r.spare_part_name || undefined,
    movementType: r.movement_type,
    movementReason: r.movement_reason,
    qty: r.qty,
    unitPrice: Number(r.unit_price),
    stockBefore: r.stock_before,
    stockAfter: r.stock_after,
    referenceId: r.reference_id,
    operatorId: r.operator_id,
    operatorName: r.operator_name || undefined,
    remark: r.remark,
    createdAt: r.created_at,
  };
}

function mapMaintenanceRecord(r) {
  if (!r) return null;
  return {
    id: r.id,
    equipmentId: r.equipment_id,
    equipmentName: r.equipment_name || undefined,
    projectId: r.project_id || undefined,
    recordType: r.record_type,
    startDate: r.start_date,
    endDate: r.end_date,
    operatorId: r.operator_id,
    operatorName: r.operator_name || undefined,
    faultDesc: r.fault_desc,
    actionDesc: r.action_desc,
    result: r.result,
    totalCost: Number(r.total_cost),
    parts: [],
    createdAt: r.created_at,
  };
}

function mapMaintenancePart(r) {
  if (!r) return null;
  return {
    id: r.id,
    maintenanceId: r.maintenance_id,
    sparePartId: r.spare_part_id,
    sparePartName: r.spare_part_name || undefined,
    sparePartCode: r.spare_part_code || undefined,
    qty: r.qty,
    unitPrice: Number(r.unit_price),
    subtotal: Number(r.subtotal),
  };
}

function mapInspection(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    inspectorId: r.inspector_id,
    inspectDate: r.inspect_date,
    type: r.type,
    result: r.result,
    issues: r.issues,
    createdAt: r.created_at,
  };
}

/* --------------------------- 初始化/重置 --------------------------- */

async function seed() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
      'maintenance_parts', 'spare_part_movements', 'maintenance_records',
      'equipment_histories', 'inspections', 'equipments', 'spare_parts',
      'projects', 'users',
    ]) {
      await conn.query(`TRUNCATE TABLE ${t}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    await conn.query(
      `INSERT INTO users (id, username, password_hash, name, role, department) VALUES
        (1, 'admin', ?, '系统管理员', 'ADMIN', '人防办信息科'),
        (2, 'manager', ?, '张管理', 'MANAGER', '工程管理科'),
        (3, 'inspector', ?, '李巡检', 'INSPECTOR', '维护管理科')`,
      [hashPassword('admin123'), hashPassword('manager123'), hashPassword('inspect123')],
    );

    await conn.query(
      `INSERT INTO projects (id, code, name, type, protection_level, area_sqm, address, district, peacetime_use, status, completed_at) VALUES
        (1, 'RF-2024-001', '中心广场地下人防工程', 'COMBINED', '6', 8600.50, '人民中路1号地下', '城关区', '地下停车场', 'NORMAL', '2018-09-01'),
        (2, 'RF-2024-002', '滨江路防空地下室', 'BASEMENT', '6B', 3200.00, '滨江路88号', '江南区', '商业仓储', 'NORMAL', '2020-05-15'),
        (3, 'RF-2024-003', '老城区单建掘开式工程', 'SINGLE', '5', 5400.00, '解放街地下', '城关区', '暂未利用', 'MAINTENANCE', '2010-03-20'),
        (4, 'RF-2024-004', '科技园人员掩蔽所', 'SHELTER', '6', 2100.00, '科技大道12号地下', '高新区', '社区活动中心', 'NORMAL', '2021-11-30')`,
    );

    await conn.query(
      `INSERT INTO equipments (id, project_id, name, category, model, serial_no, install_date, commission_date, design_life_years, warranty_end_date, last_maintain_date, maintain_cycle_days, status, remark) VALUES
        (1, 1, '1号防护密闭门', 'PROTECTIVE_DOOR', 'HFM2030', 'HFM-2018-001', '2018-08-01', '2018-09-01', 20, '2026-07-15', '2026-03-01', 180, 'NORMAL', '在保，正常使用'),
        (2, 1, '战时通风机', 'VENTILATION', 'F300', 'FAN-2018-002', '2018-08-10', '2018-09-01', 15, '2025-08-31', '2026-02-15', 90, 'NORMAL', '已出保'),
        (3, 1, '柴油发电机组', 'POWER', '50GF', 'GEN-2018-003', '2018-08-15', '2018-09-01', 15, '2024-08-31', '2025-12-01', 120, 'FAULT', '油路堵塞待修'),
        (4, 2, '防爆波活门', 'PROTECTIVE_DOOR', 'HK600', 'HK-2020-004', '2020-04-20', '2020-05-15', 20, '2027-05-14', '2026-04-10', 180, 'NORMAL', '在保'),
        (5, 2, '给排水泵', 'WATER', 'WQ15', 'PUMP-2020-005', '2020-05-01', '2020-05-15', 10, '2023-05-14', '2025-10-01', 120, 'FAULT', '叶轮磨损严重'),
        (6, 3, '滤毒通风设备', 'VENTILATION', 'LD60', 'LD-2010-006', '2010-03-01', '2010-03-20', 15, '2015-03-19', '2024-06-01', 90, 'MAINTENANCE', '超过设计寿命，滤毒罐老化'),
        (7, 3, '旧防护门', 'PROTECTIVE_DOOR', 'HFM1520', 'HFM-2010-007', '2010-03-01', '2010-03-20', 15, '2015-03-19', '2023-01-10', 180, 'SCRAPPED', '已报废，锈蚀严重'),
        (8, 4, '新型滤毒罐组', 'VENTILATION', 'LD120', 'LD-2021-008', '2021-11-10', '2021-11-30', 20, '2028-11-29', '2026-05-20', 90, 'NORMAL', '新设备，在保'),
        (9, 4, '生活给水泵', 'WATER', 'WQ25', 'PUMP-2021-009', '2021-11-15', '2021-11-30', 10, '2026-07-30', '2026-04-15', 120, 'NORMAL', '即将出保'),
        (10, 1, '备用发电机轴承', 'POWER', 'SKF-6312', 'BRG-2018-010', '2018-08-15', '2018-09-01', 8, '2023-08-31', '2025-09-01', 365, 'NORMAL', '关键易损件')`,
    );

    await conn.query(
      `INSERT INTO equipment_histories (equipment_id, event_type, from_status, to_status, event_date, operator_id, description, cost, reference_id) VALUES
        (1, 'COMMISSION', NULL, 'NORMAL', '2018-09-01', 2, '工程竣工，设备正式启用', 0, NULL),
        (2, 'COMMISSION', NULL, 'NORMAL', '2018-09-01', 2, '工程竣工，设备正式启用', 0, NULL),
        (3, 'COMMISSION', NULL, 'NORMAL', '2018-09-01', 2, '工程竣工，设备正式启用', 0, NULL),
        (6, 'COMMISSION', NULL, 'NORMAL', '2010-03-20', 2, '设备启用', 0, NULL),
        (7, 'COMMISSION', NULL, 'NORMAL', '2010-03-20', 2, '设备启用', 0, NULL),
        (7, 'SCRAP', 'NORMAL', 'SCRAPPED', '2025-11-20', 2, '锈蚀严重，超过设计寿命，申请报废', 0, NULL),
        (6, 'STATUS_CHANGE', 'NORMAL', 'MAINTENANCE', '2026-01-15', 3, '滤毒能力下降，进入维护状态', 0, NULL),
        (3, 'STATUS_CHANGE', 'NORMAL', 'FAULT', '2026-05-20', 3, '日常巡检发现启动困难、油路异常', 0, NULL),
        (5, 'STATUS_CHANGE', 'NORMAL', 'FAULT', '2026-05-10', 3, '泵体异响，出水量不足', 0, NULL),
        (1, 'MAINTENANCE', NULL, NULL, '2026-03-01', 3, '季度例行保养：密封检查、机构润滑', 200, NULL),
        (2, 'MAINTENANCE', NULL, NULL, '2026-02-15', 3, '风机润滑、皮带检查、滤芯更换', 350, NULL)`,
    );

    await conn.query(
      `INSERT INTO spare_parts (id, code, name, category, specification, unit, stock_qty, safety_stock, unit_price, location, remark) VALUES
        (1, 'SP-001', '滤毒罐', 'FILTER', 'LD-600型', '个', 12, 10, 1800.00, 'A区货架1层', '核心消耗品'),
        (2, 'SP-002', '橡胶密封条', 'SEAL', 'HFM2030专用', '米', 3, 20, 45.00, 'A区货架2层', '库存不足预警'),
        (3, 'SP-003', '深沟球轴承', 'BEARING', 'SKF 6312', '个', 20, 5, 320.00, 'B区货架1层', '发电机通用'),
        (4, 'SP-004', '给水泵叶轮', 'IMPELLER', 'WQ15配套', '个', 0, 3, 580.00, 'B区货架2层', '已缺货'),
        (5, 'SP-005', '风机皮带', 'BELT', 'B型2500mm', '条', 8, 6, 65.00, 'A区货架3层', ''),
        (6, 'SP-006', '润滑油', 'LUBRICANT', '锂基脂2#', '桶', 15, 5, 120.00, 'C区油品柜', ''),
        (7, 'SP-007', '发电机滤芯套装', 'FILTER', '50GF三件套', '套', 4, 4, 420.00, 'B区货架3层', '库存临界'),
        (8, 'SP-008', '防爆接线盒', 'ELECTRIC', 'AH-20', '个', 25, 10, 85.00, 'D区电料柜', ''),
        (9, 'SP-009', '压力表', 'INSTRUMENT', '0-1.6MPa 耐震', '块', 2, 5, 150.00, 'D区仪器柜', '低于安全库存'),
        (10, 'SP-010', '阀门密封圈', 'SEAL', 'DN100丁腈橡胶', '包', 30, 10, 28.00, 'A区货架4层', '')`,
    );

    await conn.query(
      `INSERT INTO spare_part_movements (spare_part_id, movement_type, movement_reason, qty, unit_price, stock_before, stock_after, reference_id, operator_id, remark) VALUES
        (1, 'IN', 'PURCHASE', 20, 1750.00, 0, 20, NULL, 2, '期初入库，采购价1750'),
        (2, 'IN', 'PURCHASE', 50, 42.00, 0, 50, NULL, 2, '期初入库'),
        (3, 'IN', 'PURCHASE', 25, 300.00, 0, 25, NULL, 2, '期初入库'),
        (4, 'IN', 'PURCHASE', 5, 560.00, 0, 5, NULL, 2, '期初入库'),
        (5, 'IN', 'PURCHASE', 15, 60.00, 0, 15, NULL, 2, '期初入库'),
        (6, 'IN', 'PURCHASE', 20, 110.00, 0, 20, NULL, 2, '期初入库'),
        (7, 'IN', 'PURCHASE', 8, 400.00, 0, 8, NULL, 2, '期初入库'),
        (8, 'IN', 'PURCHASE', 30, 80.00, 0, 30, NULL, 2, '期初入库'),
        (9, 'IN', 'PURCHASE', 10, 140.00, 0, 10, NULL, 2, '期初入库'),
        (10, 'IN', 'PURCHASE', 50, 25.00, 0, 50, NULL, 2, '期初入库'),
        (1, 'OUT', 'MAINTENANCE', 8, 1800.00, 20, 12, NULL, 3, '滤毒设备年度更换'),
        (2, 'OUT', 'MAINTENANCE', 47, 45.00, 50, 3, NULL, 3, '防护门密封更换'),
        (3, 'OUT', 'REPAIR', 5, 320.00, 25, 20, NULL, 3, '风机轴承更换'),
        (4, 'OUT', 'REPAIR', 5, 580.00, 5, 0, NULL, 3, '水泵叶轮磨损更换'),
        (5, 'OUT', 'MAINTENANCE', 7, 65.00, 15, 8, NULL, 3, '风机皮带老化更换'),
        (6, 'OUT', 'MAINTENANCE', 5, 120.00, 20, 15, NULL, 3, '设备润滑'),
        (7, 'OUT', 'MAINTENANCE', 4, 420.00, 8, 4, NULL, 3, '发电机季度保养'),
        (8, 'OUT', 'REPAIR', 5, 85.00, 30, 25, NULL, 3, '线路整改'),
        (9, 'OUT', 'REPAIR', 8, 150.00, 10, 2, NULL, 3, '旧表到期更换'),
        (10, 'OUT', 'MAINTENANCE', 20, 28.00, 50, 30, NULL, 3, '阀门年度密封检修')`,
    );

    await conn.query(
      `INSERT INTO maintenance_records (id, equipment_id, record_type, start_date, end_date, operator_id, fault_desc, action_desc, result, total_cost) VALUES
        (1, 1, 'MAINTENANCE', '2026-03-01', '2026-03-01', 3, '', '密封条检查、铰链润滑、闭锁机构调校', 'DONE', 245.00),
        (2, 2, 'MAINTENANCE', '2026-02-15', '2026-02-15', 3, '', '更换皮带、轴承加脂、滤芯清洁', 'DONE', 745.00),
        (3, 6, 'REPAIR', '2026-01-15', '2026-01-20', 3, '滤毒效率降至65%，壳体有锈蚀点', '更换滤毒罐、除锈防腐处理、更换密封垫', 'PARTIAL', 15060.00)`,
    );

    await conn.query(
      `INSERT INTO maintenance_parts (maintenance_id, spare_part_id, qty, unit_price, subtotal) VALUES
        (1, 2, 5, 45.00, 225.00),
        (1, 6, 1, 20.00, 20.00),
        (2, 5, 2, 65.00, 130.00),
        (2, 3, 1, 320.00, 320.00),
        (2, 6, 2, 120.00, 240.00),
        (3, 1, 8, 1800.00, 14400.00),
        (3, 10, 20, 28.00, 560.00),
        (3, 2, 2, 45.00, 90.00)`,
    );

    await conn.query(
      `INSERT INTO inspections (project_id, inspector_id, inspect_date, type, result, issues) VALUES
        (1, 3, '2026-05-10', 'ROUTINE', 'PASS', ''),
        (2, 3, '2026-05-12', 'ROUTINE', 'FAIL', '给排水泵故障，需更换叶轮'),
        (3, 3, '2026-04-20', 'SPECIAL', 'FAIL', '滤毒设备老化，旧防护门需报废更新'),
        (1, 3, '2026-06-01', 'ROUTINE', 'PASS', ''),
        (4, 3, '2026-05-25', 'ANNUAL', 'PASS', '设备整体状况良好')`,
    );
  } finally {
    conn.release();
  }
}

async function isEmpty() {
  const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  return rows[0].cnt === 0;
}

/* ----------------------------- 用户 ----------------------------- */

async function findUserByUsername(username) {
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  return mapUserWithHash(rows[0]);
}

async function getUser(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return mapUser(rows[0]);
}

async function listUsers() {
  const [rows] = await pool.query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUser);
}

async function createUser({ username, password, name = '', role = 'INSPECTOR', department = '' }) {
  const [r] = await pool.query(
    'INSERT INTO users (username, password_hash, name, role, department) VALUES (?, ?, ?, ?, ?)',
    [username, hashPassword(password), name, role, department],
  );
  return getUser(r.insertId);
}

/* ----------------------------- 人防工程 ----------------------------- */

async function listProjects({ status, district, keyword } = {}) {
  const where = [];
  const params = [];
  if (status !== undefined) { where.push('status = ?'); params.push(status); }
  if (district !== undefined) { where.push('district = ?'); params.push(district); }
  if (keyword !== undefined && keyword !== '') {
    where.push('(name LIKE ? OR code LIKE ? OR address LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT * FROM projects ${clause} ORDER BY id`, params);
  return rows.map(mapProject);
}

async function getProject(id) {
  const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
  return mapProject(rows[0]);
}

async function findProjectByCode(code) {
  const [rows] = await pool.query('SELECT * FROM projects WHERE code = ?', [code]);
  return mapProject(rows[0]);
}

async function createProject(p) {
  const [r] = await pool.query(
    `INSERT INTO projects (code, name, type, protection_level, area_sqm, address, district, peacetime_use, status, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.code, p.name, p.type || 'COMBINED', p.protectionLevel || '6', p.areaSqm || 0,
     p.address || '', p.district || '', p.peacetimeUse || '', p.status || 'NORMAL', p.completedAt || null],
  );
  return getProject(r.insertId);
}

async function updateProject(id, patch) {
  const map = {
    name: 'name', type: 'type', protectionLevel: 'protection_level', areaSqm: 'area_sqm',
    address: 'address', district: 'district', peacetimeUse: 'peacetime_use',
    status: 'status', completedAt: 'completed_at',
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await pool.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getProject(id);
}

async function deleteProject(id) {
  const [r] = await pool.query('DELETE FROM projects WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 设备设施（扩展） ----------------------------- */

async function getEquipment(id) {
  const [rows] = await pool.query('SELECT * FROM equipments WHERE id = ?', [id]);
  return mapEquipment(rows[0]);
}

async function listEquipments(projectId, { status, category, alertLevel } = {}) {
  const where = [];
  const params = [];
  if (projectId !== undefined) { where.push('project_id = ?'); params.push(projectId); }
  if (status !== undefined) { where.push('status = ?'); params.push(status); }
  if (category !== undefined) { where.push('category = ?'); params.push(category); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT * FROM equipments ${clause} ORDER BY id`, params);
  const list = rows.map(mapEquipment);
  if (alertLevel !== undefined) {
    return list.filter((e) => e.lifecycle.alertLevel === alertLevel);
  }
  return list;
}

async function listAllEquipments(filter = {}) {
  return listEquipments(undefined, filter);
}

async function createEquipment(e) {
  const [r] = await pool.query(
    `INSERT INTO equipments (project_id, name, category, model, serial_no, install_date, commission_date, design_life_years, warranty_end_date, last_maintain_date, maintain_cycle_days, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.projectId, e.name, e.category || 'OTHER', e.model || '', e.serialNo || '',
     e.installDate || null, e.commissionDate || e.installDate || null,
     e.designLifeYears || 15, e.warrantyEndDate || null, e.lastMaintainDate || null,
     e.maintainCycleDays || 180, e.status || 'NORMAL', e.remark || ''],
  );
  return getEquipment(r.insertId);
}

async function updateEquipment(id, patch) {
  const map = {
    name: 'name', category: 'category', model: 'model', serialNo: 'serial_no',
    installDate: 'install_date', commissionDate: 'commission_date',
    designLifeYears: 'design_life_years', warrantyEndDate: 'warranty_end_date',
    lastMaintainDate: 'last_maintain_date', maintainCycleDays: 'maintain_cycle_days',
    status: 'status', remark: 'remark',
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await pool.query(`UPDATE equipments SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getEquipment(id);
}

/* ----------------------------- 设备状态流转与履历 ----------------------------- */

const VALID_EQ_STATUSES = ['NORMAL', 'FAULT', 'MAINTENANCE', 'SCRAPPED'];
const STATUS_TRANSITIONS = {
  NORMAL: ['FAULT', 'MAINTENANCE', 'SCRAPPED'],
  FAULT: ['MAINTENANCE', 'NORMAL', 'SCRAPPED'],
  MAINTENANCE: ['NORMAL', 'FAULT', 'SCRAPPED'],
  SCRAPPED: [],
};

function isValidStatusTransition(from, to) {
  if (!from) return true;
  return (STATUS_TRANSITIONS[from] || []).includes(to);
}

async function addEquipmentHistory({ equipmentId, eventType, fromStatus, toStatus,
  eventDate, operatorId, description = '', cost = 0, referenceId = null }) {
  await pool.query(
    `INSERT INTO equipment_histories (equipment_id, event_type, from_status, to_status, event_date, operator_id, description, cost, reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [equipmentId, eventType, fromStatus || null, toStatus || null, eventDate || today(),
     operatorId || null, description, Number(cost) || 0, referenceId],
  );
}

async function listEquipmentHistories(equipmentId) {
  const [rows] = await pool.query(
    `SELECT h.*, u.name AS operator_name
     FROM equipment_histories h LEFT JOIN users u ON h.operator_id = u.id
     WHERE h.equipment_id = ? ORDER BY h.event_date DESC, h.id DESC`,
    [equipmentId],
  );
  return rows.map(mapEquipmentHistory);
}

async function changeEquipmentStatus(id, { toStatus, operatorId, description, eventDate, cost = 0 }) {
  if (!VALID_EQ_STATUSES.includes(toStatus)) {
    throw new Error('INVALID_STATUS');
  }
  const current = await getEquipment(id);
  if (!current) throw new Error('NOT_FOUND');
  if (current.status === 'SCRAPPED') throw new Error('SCRAPPED_CANNOT_CHANGE');
  if (!isValidStatusTransition(current.status, toStatus)) {
    throw new Error('INVALID_TRANSITION');
  }
  await updateEquipment(id, { status: toStatus });
  let eventType = 'STATUS_CHANGE';
  if (toStatus === 'SCRAPPED') eventType = 'SCRAP';
  await addEquipmentHistory({
    equipmentId: id, eventType,
    fromStatus: current.status, toStatus,
    eventDate: eventDate || today(), operatorId, description, cost,
  });
  return getEquipment(id);
}

async function scrapEquipment(id, { operatorId, description, eventDate }) {
  return changeEquipmentStatus(id, {
    toStatus: 'SCRAPPED', operatorId, description, eventDate,
  });
}

/* ----------------------------- 备品备件 ----------------------------- */

async function getSparePart(id) {
  const [rows] = await pool.query('SELECT * FROM spare_parts WHERE id = ?', [id]);
  return mapSparePart(rows[0]);
}

async function findSparePartByCode(code) {
  const [rows] = await pool.query('SELECT * FROM spare_parts WHERE code = ?', [code]);
  return mapSparePart(rows[0]);
}

async function listSpareParts({ category, keyword, stockStatus } = {}) {
  const where = [];
  const params = [];
  if (category !== undefined) { where.push('category = ?'); params.push(category); }
  if (keyword !== undefined && keyword !== '') {
    where.push('(name LIKE ? OR code LIKE ? OR specification LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT * FROM spare_parts ${clause} ORDER BY id`, params);
  let list = rows.map(mapSparePart);
  if (stockStatus !== undefined) {
    list = list.filter((s) => s.stockStatus === stockStatus);
  }
  return list;
}

async function listLowStockSpareParts() {
  const [rows] = await pool.query(
    'SELECT * FROM spare_parts WHERE stock_qty < safety_stock ORDER BY (stock_qty - safety_stock) ASC',
  );
  return rows.map(mapSparePart);
}

async function createSparePart(p) {
  const [r] = await pool.query(
    `INSERT INTO spare_parts (code, name, category, specification, unit, stock_qty, safety_stock, unit_price, location, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.code, p.name, p.category || 'OTHER', p.specification || '', p.unit || '个',
     0, p.safetyStock || 5, p.unitPrice || 0, p.location || '', p.remark || ''],
  );
  return getSparePart(r.insertId);
}

async function updateSparePart(id, patch) {
  const map = {
    code: 'code', name: 'name', category: 'category', specification: 'specification',
    unit: 'unit', safetyStock: 'safety_stock', unitPrice: 'unit_price',
    location: 'location', remark: 'remark',
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await pool.query(`UPDATE spare_parts SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getSparePart(id);
}

async function deleteSparePart(id) {
  const [r] = await pool.query('DELETE FROM spare_parts WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 备件出入库（事务+并发安全） ----------------------------- */

const VALID_MOVE_TYPES = ['IN', 'OUT'];
const VALID_MOVE_REASONS = ['PURCHASE', 'MAINTENANCE', 'REPAIR', 'ADJUST', 'RETURN'];

async function stockIn({ sparePartId, qty, unitPrice = null, reason = 'PURCHASE',
  referenceId = null, operatorId = null, remark = '' }) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('INVALID_QTY');
  if (!VALID_MOVE_REASONS.includes(reason)) throw new Error('INVALID_REASON');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM spare_parts WHERE id = ? FOR UPDATE', [sparePartId]);
    if (!rows.length) { await conn.rollback(); throw new Error('NOT_FOUND'); }
    const stockBefore = rows[0].stock_qty;
    const price = unitPrice !== null ? Number(unitPrice) : Number(rows[0].unit_price);
    const stockAfter = stockBefore + qty;
    await conn.query(
      'UPDATE spare_parts SET stock_qty = ?, unit_price = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [stockAfter, price, sparePartId],
    );
    const [r] = await conn.query(
      `INSERT INTO spare_part_movements (spare_part_id, movement_type, movement_reason, qty, unit_price, stock_before, stock_after, reference_id, operator_id, remark)
       VALUES (?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sparePartId, reason, qty, price, stockBefore, stockAfter, referenceId, operatorId, remark || ''],
    );
    await conn.commit();
    return { movementId: r.insertId, stockAfter };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function stockOut({ sparePartId, qty, reason = 'MAINTENANCE',
  referenceId = null, operatorId = null, remark = '' }) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('INVALID_QTY');
  if (!VALID_MOVE_REASONS.includes(reason)) throw new Error('INVALID_REASON');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM spare_parts WHERE id = ? FOR UPDATE', [sparePartId]);
    if (!rows.length) { await conn.rollback(); throw new Error('NOT_FOUND'); }
    const stockBefore = rows[0].stock_qty;
    if (stockBefore < qty) { await conn.rollback(); throw new Error('INSUFFICIENT_STOCK'); }
    const price = Number(rows[0].unit_price);
    const stockAfter = stockBefore - qty;
    await conn.query(
      'UPDATE spare_parts SET stock_qty = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [stockAfter, sparePartId],
    );
    const [r] = await conn.query(
      `INSERT INTO spare_part_movements (spare_part_id, movement_type, movement_reason, qty, unit_price, stock_before, stock_after, reference_id, operator_id, remark)
       VALUES (?, 'OUT', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sparePartId, reason, qty, price, stockBefore, stockAfter, referenceId, operatorId, remark || ''],
    );
    await conn.commit();
    return { movementId: r.insertId, stockAfter };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listSparePartMovements({ sparePartId, movementType, movementReason } = {}) {
  const where = [];
  const params = [];
  if (sparePartId !== undefined) { where.push('m.spare_part_id = ?'); params.push(sparePartId); }
  if (movementType !== undefined) { where.push('m.movement_type = ?'); params.push(movementType); }
  if (movementReason !== undefined) { where.push('m.movement_reason = ?'); params.push(movementReason); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT m.*, s.name AS spare_part_name, u.name AS operator_name
     FROM spare_part_movements m
     LEFT JOIN spare_parts s ON m.spare_part_id = s.id
     LEFT JOIN users u ON m.operator_id = u.id
     ${clause} ORDER BY m.created_at DESC, m.id DESC`,
    params,
  );
  return rows.map(mapSparePartMovement);
}

async function verifySparePartStock(id) {
  const [inRows] = await pool.query(
    'SELECT COALESCE(SUM(qty),0) AS total FROM spare_part_movements WHERE spare_part_id = ? AND movement_type = ?',
    [id, 'IN'],
  );
  const [outRows] = await pool.query(
    'SELECT COALESCE(SUM(qty),0) AS total FROM spare_part_movements WHERE spare_part_id = ? AND movement_type = ?',
    [id, 'OUT'],
  );
  const computed = Number(inRows[0].total) - Number(outRows[0].total);
  const part = await getSparePart(id);
  return {
    sparePartId: id,
    currentStock: part ? part.stockQty : 0,
    computedStock: computed,
    matches: part ? part.stockQty === computed : false,
    inTotal: Number(inRows[0].total),
    outTotal: Number(outRows[0].total),
  };
}

/* ----------------------------- 维修/维护记录（联动备件扣减） ----------------------------- */

async function getMaintenanceRecord(id) {
  const [rows] = await pool.query(
    `SELECT m.*, e.name AS equipment_name, e.project_id, u.name AS operator_name
     FROM maintenance_records m
     LEFT JOIN equipments e ON m.equipment_id = e.id
     LEFT JOIN users u ON m.operator_id = u.id
     WHERE m.id = ?`,
    [id],
  );
  if (!rows.length) return null;
  const rec = mapMaintenanceRecord(rows[0]);
  rec.parts = await listMaintenanceParts(id);
  return rec;
}

async function listMaintenanceRecords({ equipmentId, recordType, result } = {}) {
  const where = [];
  const params = [];
  if (equipmentId !== undefined) { where.push('equipment_id = ?'); params.push(equipmentId); }
  if (recordType !== undefined) { where.push('record_type = ?'); params.push(recordType); }
  if (result !== undefined) { where.push('result = ?'); params.push(result); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT m.*, e.name AS equipment_name, e.project_id, u.name AS operator_name
     FROM maintenance_records m
     LEFT JOIN equipments e ON m.equipment_id = e.id
     LEFT JOIN users u ON m.operator_id = u.id
     ${clause} ORDER BY m.start_date DESC, m.id DESC`,
    params,
  );
  return rows.map(mapMaintenanceRecord);
}

async function listMaintenanceParts(maintenanceId) {
  const [rows] = await pool.query(
    `SELECT mp.*, s.name AS spare_part_name, s.code AS spare_part_code
     FROM maintenance_parts mp LEFT JOIN spare_parts s ON mp.spare_part_id = s.id
     WHERE mp.maintenance_id = ? ORDER BY mp.id`,
    [maintenanceId],
  );
  return rows.map(mapMaintenancePart);
}

async function createMaintenanceRecord({ equipmentId, recordType, startDate, endDate = null,
  operatorId = null, faultDesc = '', actionDesc = '', result = 'PENDING', parts = [] }) {
  if (!['MAINTENANCE', 'REPAIR'].includes(recordType)) throw new Error('INVALID_TYPE');
  const eq = await getEquipment(equipmentId);
  if (!eq) throw new Error('EQUIPMENT_NOT_FOUND');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO maintenance_records (equipment_id, record_type, start_date, end_date, operator_id, fault_desc, action_desc, result, total_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [equipmentId, recordType, startDate, endDate, operatorId, faultDesc, actionDesc, result],
    );
    const maintId = r.insertId;
    let totalCost = 0;
    if (parts && parts.length) {
      for (const p of parts) {
        const pid = Number(p.sparePartId);
        const qty = Number(p.qty);
        if (!pid || !Number.isInteger(qty) || qty <= 0) throw new Error('INVALID_PART');
        const [spRows] = await conn.query('SELECT * FROM spare_parts WHERE id = ? FOR UPDATE', [pid]);
        if (!spRows.length) throw new Error('PART_NOT_FOUND');
        if (spRows[0].stock_qty < qty) throw new Error(`PART_INSUFFICIENT:${pid}`);
        const price = Number(spRows[0].unit_price);
        const subtotal = price * qty;
        totalCost += subtotal;
        await conn.query('INSERT INTO maintenance_parts (maintenance_id, spare_part_id, qty, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
          [maintId, pid, qty, price, subtotal]);
        const sb = spRows[0].stock_qty;
        const sa = sb - qty;
        await conn.query('UPDATE spare_parts SET stock_qty = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [sa, pid]);
        await conn.query(
          `INSERT INTO spare_part_movements (spare_part_id, movement_type, movement_reason, qty, unit_price, stock_before, stock_after, reference_id, operator_id, remark)
           VALUES (?, 'OUT', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pid, recordType, qty, price, sb, sa, maintId, operatorId, `维修#${maintId}领用`],
        );
      }
    }
    await conn.query('UPDATE maintenance_records SET total_cost = ? WHERE id = ?', [totalCost, maintId]);
    await addEquipmentHistory({
      equipmentId, eventType: recordType,
      eventDate: startDate, operatorId,
      description: actionDesc || `${recordType === 'MAINTENANCE' ? '维护' : '维修'}作业登记`,
      cost: totalCost, referenceId: maintId,
    });
    const needUpdate = result === 'DONE';
    if (needUpdate) {
      await conn.query('UPDATE equipments SET last_maintain_date = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [endDate || startDate, equipmentId]);
      if (eq.status !== 'SCRAPPED') {
        await conn.query('UPDATE equipments SET status = ? WHERE id = ?', ['NORMAL', equipmentId]);
      }
    }
    await conn.commit();
    return getMaintenanceRecord(maintId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function updateMaintenanceRecord(id, patch) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM maintenance_records WHERE id = ?', [id]);
    if (!rows.length) { await conn.rollback(); throw new Error('NOT_FOUND'); }
    const cur = rows[0];
    const map = {
      startDate: 'start_date', endDate: 'end_date',
      faultDesc: 'fault_desc', actionDesc: 'action_desc', result: 'result',
    };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k]); }
    }
    const newResult = patch.result || cur.result;
    if (newResult === 'DONE' && cur.result !== 'DONE') {
      await conn.query('UPDATE equipments SET last_maintain_date = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [patch.endDate || cur.end_date || cur.start_date, cur.equipment_id]);
      const [eqRows] = await conn.query('SELECT status FROM equipments WHERE id = ?', [cur.equipment_id]);
      if (eqRows.length && eqRows[0].status !== 'SCRAPPED') {
        await conn.query('UPDATE equipments SET status = ? WHERE id = ?', ['NORMAL', cur.equipment_id]);
      }
    }
    if (sets.length) {
      params.push(id);
      await conn.query(`UPDATE maintenance_records SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    await conn.commit();
    return getMaintenanceRecord(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ----------------------------- 维修-备件反查 ----------------------------- */

async function listPartsUsedByMaintenance(maintenanceId) {
  return listMaintenanceParts(maintenanceId);
}

async function listMaintenancesBySparePart(sparePartId) {
  const [rows] = await pool.query(
    `SELECT m.*, e.name AS equipment_name, e.project_id
     FROM maintenance_parts mp
     JOIN maintenance_records m ON mp.maintenance_id = m.id
     LEFT JOIN equipments e ON m.equipment_id = e.id
     WHERE mp.spare_part_id = ? ORDER BY m.start_date DESC`,
    [sparePartId],
  );
  return rows.map(mapMaintenanceRecord);
}

/* ----------------------------- 统计报表 ----------------------------- */

async function getEquipmentStatsByProject() {
  const [rows] = await pool.query(
    `SELECT p.id AS project_id, p.name AS project_name, p.code AS project_code,
            COUNT(e.id) AS total,
            SUM(CASE WHEN e.status = 'NORMAL' THEN 1 ELSE 0 END) AS normal_count,
            SUM(CASE WHEN e.status = 'FAULT' THEN 1 ELSE 0 END) AS fault_count,
            SUM(CASE WHEN e.status = 'MAINTENANCE' THEN 1 ELSE 0 END) AS maintenance_count,
            SUM(CASE WHEN e.status = 'SCRAPPED' THEN 1 ELSE 0 END) AS scrapped_count
     FROM projects p LEFT JOIN equipments e ON p.id = e.project_id
     GROUP BY p.id, p.name, p.code ORDER BY p.id`,
  );
  return rows.map((r) => ({
    projectId: r.project_id,
    projectCode: r.project_code,
    projectName: r.project_name,
    total: Number(r.total),
    normalCount: Number(r.normal_count),
    faultCount: Number(r.fault_count),
    maintenanceCount: Number(r.maintenance_count),
    scrappedCount: Number(r.scrapped_count),
    intactRate: r.total > 0
      ? Math.round((Number(r.normal_count) / Number(r.total)) * 10000) / 100
      : 0,
    activeIntactRate: (Number(r.total) - Number(r.scrapped_count)) > 0
      ? Math.round((Number(r.normal_count) / (Number(r.total) - Number(r.scrapped_count))) * 10000) / 100
      : 0,
  }));
}

async function getEquipmentsWarrantyExpiring(days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const now = today();
  const [rows] = await pool.query(
    `SELECT e.*, p.name AS project_name, p.code AS project_code
     FROM equipments e JOIN projects p ON e.project_id = p.id
     WHERE e.warranty_end_date IS NOT NULL
       AND e.warranty_end_date >= ?
       AND e.warranty_end_date <= ?
       AND e.status != 'SCRAPPED'
     ORDER BY e.warranty_end_date ASC`,
    [now, cutoffStr],
  );
  return rows.map((r) => ({
    ...mapEquipment(r),
    projectName: r.project_name,
    projectCode: r.project_code,
    daysLeft: daysDiff(now, r.warranty_end_date),
  }));
}

async function getEquipmentsWarrantyExpired() {
  const now = today();
  const [rows] = await pool.query(
    `SELECT e.*, p.name AS project_name, p.code AS project_code
     FROM equipments e JOIN projects p ON e.project_id = p.id
     WHERE e.warranty_end_date IS NOT NULL
       AND e.warranty_end_date < ?
       AND e.status != 'SCRAPPED'
     ORDER BY e.warranty_end_date ASC`,
    [now],
  );
  return rows.map((r) => ({
    ...mapEquipment(r),
    projectName: r.project_name,
    projectCode: r.project_code,
    daysExpired: -daysDiff(now, r.warranty_end_date),
  }));
}

async function getEquipmentsNearEndOfLife(months = 6) {
  const now = today();
  const [rows] = await pool.query(
    `SELECT e.*, p.name AS project_name, p.code AS project_code,
            COALESCE(e.commission_date, e.install_date) AS base_date
     FROM equipments e JOIN projects p ON e.project_id = p.id
     WHERE COALESCE(e.commission_date, e.install_date) IS NOT NULL
       AND e.status != 'SCRAPPED'
     ORDER BY base_date ASC`,
  );
  return rows
    .map((r) => {
      const base = r.base_date;
      const endDate = addYears(base, r.design_life_years);
      const dl = daysDiff(now, endDate);
      const monthsLeft = Math.ceil(dl / 30);
      const usedDays = daysDiff(base, now);
      const totalDays = r.design_life_years * 365;
      return {
        ...mapEquipment(r),
        projectName: r.project_name,
        projectCode: r.project_code,
        designEndDate: endDate,
        monthsLeft,
        isOverdue: dl < 0,
        isNear: !isNaN(dl) && dl >= 0 && monthsLeft <= months,
        usedRatio: Math.max(0, Math.min(1, totalDays > 0 ? usedDays / totalDays : 0)),
      };
    })
    .filter((r) => r.isOverdue || r.isNear)
    .sort((a, b) => a.monthsLeft - b.monthsLeft);
}

async function getEquipmentsMaintenanceDue() {
  const all = await listAllEquipments();
  return all
    .filter((e) => e.status !== 'SCRAPPED' && (e.lifecycle.maintainDue || e.lifecycle.maintainOverdue))
    .map((e) => ({ ...e }));
}

async function getLowStockAlertList() {
  return listLowStockSpareParts();
}

async function getProblemEquipmentsTop(limit = 10) {
  const [rows] = await pool.query(
    `SELECT e.id, e.name, e.model, e.project_id, p.name AS project_name, p.code AS project_code,
            COUNT(m.id) AS repair_count,
            COALESCE(SUM(m.total_cost), 0) AS total_cost,
            MAX(m.start_date) AS last_repair_date
     FROM equipments e
     JOIN projects p ON e.project_id = p.id
     LEFT JOIN maintenance_records m ON e.id = m.equipment_id AND m.record_type = 'REPAIR'
     WHERE e.status != 'SCRAPPED'
     GROUP BY e.id, e.name, e.model, e.project_id, p.name, p.code
     HAVING repair_count > 0
     ORDER BY repair_count DESC, total_cost DESC
     LIMIT ?`,
    [Number(limit) || 10],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    model: r.model,
    projectId: r.project_id,
    projectName: r.project_name,
    projectCode: r.project_code,
    repairCount: Number(r.repair_count),
    totalCost: Number(r.total_cost),
    lastRepairDate: r.last_repair_date,
  }));
}

async function getOverallStats() {
  const [eRows] = await pool.query('SELECT status, COUNT(*) AS cnt FROM equipments GROUP BY status');
  const [pRows] = await pool.query('SELECT COUNT(*) AS cnt FROM projects');
  const [sRows] = await pool.query(`SELECT
    COUNT(*) AS total_parts,
    SUM(CASE WHEN stock_qty < safety_stock THEN 1 ELSE 0 END) AS low_stock_count,
    SUM(CASE WHEN stock_qty = 0 THEN 1 ELSE 0 END) AS out_of_stock_count
    FROM spare_parts`);
  const [mRows] = await pool.query(`SELECT
    COUNT(*) AS total_maintenance,
    SUM(CASE WHEN record_type = 'REPAIR' THEN 1 ELSE 0 END) AS repair_count,
    SUM(CASE WHEN record_type = 'MAINTENANCE' THEN 1 ELSE 0 END) AS maintain_count,
    COALESCE(SUM(total_cost), 0) AS total_cost
    FROM maintenance_records`);
  const statusMap = {};
  eRows.forEach((r) => { statusMap[r.status] = Number(r.cnt); });
  const totalEq = eRows.reduce((s, r) => s + Number(r.cnt), 0);
  const activeEq = totalEq - (statusMap.SCRAPPED || 0);
  return {
    projects: { total: Number(pRows[0].cnt) },
    equipments: {
      total: totalEq,
      active: activeEq,
      byStatus: statusMap,
      intactRate: activeEq > 0
        ? Math.round(((statusMap.NORMAL || 0) / activeEq) * 10000) / 100
        : 0,
    },
    spareParts: {
      total: Number(sRows[0].total_parts),
      lowStock: Number(sRows[0].low_stock_count),
      outOfStock: Number(sRows[0].out_of_stock_count),
    },
    maintenance: {
      total: Number(mRows[0].total_maintenance),
      repairCount: Number(mRows[0].repair_count),
      maintainCount: Number(mRows[0].maintain_count),
      totalCost: Number(mRows[0].total_cost),
    },
  };
}

/* ----------------------------- 检查/维护记录 ----------------------------- */

async function listInspections({ projectId } = {}) {
  if (projectId !== undefined) {
    const [rows] = await pool.query(
      'SELECT * FROM inspections WHERE project_id = ? ORDER BY inspect_date DESC, id DESC', [projectId]);
    return rows.map(mapInspection);
  }
  const [rows] = await pool.query('SELECT * FROM inspections ORDER BY inspect_date DESC, id DESC');
  return rows.map(mapInspection);
}

async function createInspection(i) {
  const [r] = await pool.query(
    `INSERT INTO inspections (project_id, inspector_id, inspect_date, type, result, issues)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [i.projectId, i.inspectorId || null, i.inspectDate, i.type || 'ROUTINE', i.result || 'PASS', i.issues || ''],
  );
  const [rows] = await pool.query('SELECT * FROM inspections WHERE id = ?', [r.insertId]);
  return mapInspection(rows[0]);
}

module.exports = {
  seed, isEmpty,
  VALID_EQ_STATUSES, STATUS_TRANSITIONS, VALID_MOVE_REASONS,
  findUserByUsername, getUser, listUsers, createUser,
  listProjects, getProject, findProjectByCode, createProject, updateProject, deleteProject,
  getEquipment, listEquipments, listAllEquipments, createEquipment, updateEquipment,
  isValidStatusTransition, changeEquipmentStatus, scrapEquipment, addEquipmentHistory,
  listEquipmentHistories,
  getSparePart, findSparePartByCode, listSpareParts, listLowStockSpareParts,
  createSparePart, updateSparePart, deleteSparePart,
  stockIn, stockOut, listSparePartMovements, verifySparePartStock,
  getMaintenanceRecord, listMaintenanceRecords, createMaintenanceRecord, updateMaintenanceRecord,
  listPartsUsedByMaintenance, listMaintenancesBySparePart,
  getEquipmentStatsByProject, getEquipmentsWarrantyExpiring, getEquipmentsWarrantyExpired,
  getEquipmentsNearEndOfLife, getEquipmentsMaintenanceDue, getLowStockAlertList,
  getProblemEquipmentsTop, getOverallStats,
  listInspections, createInspection,
};