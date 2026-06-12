'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendError, isNonEmptyString, toPositiveInt, isValidDate } = require('../utils/http');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const VALID_EQ_STATUSES = ['NORMAL', 'FAULT', 'MAINTENANCE', 'SCRAPPED'];
const VALID_CATEGORIES = ['PROTECTIVE_DOOR', 'VENTILATION', 'POWER', 'WATER', 'OTHER'];

router.use(authRequired);

router.get('/', wrap(async (req, res) => {
  const { projectId, status, category, alertLevel } = req.query;
  const filter = {};
  if (status !== undefined) {
    if (!VALID_EQ_STATUSES.includes(status)) return sendError(res, 400, '无效的设备状态');
    filter.status = status;
  }
  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) return sendError(res, 400, '无效的设备类别');
    filter.category = category;
  }
  if (alertLevel !== undefined && !['NONE', 'INFO', 'WARNING', 'DANGER'].includes(alertLevel)) {
    return sendError(res, 400, '无效的告警级别');
  }
  filter.alertLevel = alertLevel;
  let pid = undefined;
  if (projectId !== undefined) {
    pid = toPositiveInt(projectId);
    if (pid === null) return sendError(res, 400, '无效的工程 ID');
  }
  const list = await store.listEquipments(pid, filter);
  res.json({ data: list, total: list.length });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的设备 ID');
  const e = await store.getEquipment(id);
  if (!e) return sendError(res, 404, '设备不存在');
  res.json({ data: e });
}));

router.get('/:id/histories', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的设备 ID');
  if (!(await store.getEquipment(id))) return sendError(res, 404, '设备不存在');
  const list = await store.listEquipmentHistories(id);
  res.json({ data: list, total: list.length });
}));

router.post('/', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const b = req.body || {};
  const projectId = toPositiveInt(b.projectId);
  if (projectId === null) return sendError(res, 400, '必须指定有效的工程 ID');
  if (!(await store.getProject(projectId))) return sendError(res, 400, '人防工程不存在');
  if (!isNonEmptyString(b.name)) return sendError(res, 400, '设备名称不能为空');
  if (b.status !== undefined && !VALID_EQ_STATUSES.includes(b.status)) {
    return sendError(res, 400, '无效的设备状态');
  }
  if (b.category !== undefined && !VALID_CATEGORIES.includes(b.category)) {
    return sendError(res, 400, '无效的设备类别');
  }
  if (b.installDate !== undefined && b.installDate !== null && !isValidDate(b.installDate)) {
    return sendError(res, 400, '安装日期格式无效');
  }
  if (b.commissionDate !== undefined && b.commissionDate !== null && !isValidDate(b.commissionDate)) {
    return sendError(res, 400, '启用日期格式无效');
  }
  if (b.warrantyEndDate !== undefined && b.warrantyEndDate !== null && !isValidDate(b.warrantyEndDate)) {
    return sendError(res, 400, '保修截止日期格式无效');
  }
  if (b.lastMaintainDate !== undefined && b.lastMaintainDate !== null && !isValidDate(b.lastMaintainDate)) {
    return sendError(res, 400, '上次维护日期格式无效');
  }
  if (b.designLifeYears !== undefined && (!Number.isInteger(Number(b.designLifeYears)) || Number(b.designLifeYears) <= 0)) {
    return sendError(res, 400, '设计使用年限必须是正整数');
  }
  if (b.maintainCycleDays !== undefined && (!Number.isInteger(Number(b.maintainCycleDays)) || Number(b.maintainCycleDays) <= 0)) {
    return sendError(res, 400, '维护周期必须是正整数天数');
  }
  const e = await store.createEquipment({
    projectId,
    name: String(b.name).trim(),
    category: b.category,
    model: typeof b.model === 'string' ? b.model.trim() : '',
    serialNo: typeof b.serialNo === 'string' ? b.serialNo.trim() : '',
    installDate: b.installDate || null,
    commissionDate: b.commissionDate || null,
    designLifeYears: b.designLifeYears ? Number(b.designLifeYears) : undefined,
    warrantyEndDate: b.warrantyEndDate || null,
    lastMaintainDate: b.lastMaintainDate || null,
    maintainCycleDays: b.maintainCycleDays ? Number(b.maintainCycleDays) : undefined,
    status: b.status,
    remark: typeof b.remark === 'string' ? b.remark.trim() : '',
  });
  res.status(201).json({ data: e });
}));

router.put('/:id', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的设备 ID');
  if (!(await store.getEquipment(id))) return sendError(res, 404, '设备不存在');
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) {
    if (!isNonEmptyString(b.name)) return sendError(res, 400, '设备名称不能为空');
    patch.name = String(b.name).trim();
  }
  if (b.status !== undefined) {
    if (!VALID_EQ_STATUSES.includes(b.status)) return sendError(res, 400, '无效的设备状态');
    patch.status = b.status;
  }
  if (b.category !== undefined) {
    if (!VALID_CATEGORIES.includes(b.category)) return sendError(res, 400, '无效的设备类别');
    patch.category = b.category;
  }
  for (const k of ['model', 'serialNo', 'remark']) {
    if (b[k] !== undefined) patch[k] = String(b[k]).trim();
  }
  for (const [k, col] of [
    ['installDate', '安装日期'],
    ['commissionDate', '启用日期'],
    ['warrantyEndDate', '保修截止日期'],
    ['lastMaintainDate', '上次维护日期'],
  ]) {
    if (b[k] !== undefined) {
      if (b[k] === null || b[k] === '') {
        patch[k] = null;
      } else if (!isValidDate(b[k])) {
        return sendError(res, 400, `${col}格式无效`);
      } else {
        patch[k] = b[k];
      }
    }
  }
  if (b.designLifeYears !== undefined) {
    const n = Number(b.designLifeYears);
    if (!Number.isInteger(n) || n <= 0) return sendError(res, 400, '设计使用年限必须是正整数');
    patch.designLifeYears = n;
  }
  if (b.maintainCycleDays !== undefined) {
    const n = Number(b.maintainCycleDays);
    if (!Number.isInteger(n) || n <= 0) return sendError(res, 400, '维护周期必须是正整数天数');
    patch.maintainCycleDays = n;
  }
  const updated = await store.updateEquipment(id, patch);
  res.json({ data: updated });
}));

router.post('/:id/status', requireRole('ADMIN', 'MANAGER', 'INSPECTOR'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的设备 ID');
  const b = req.body || {};
  if (!VALID_EQ_STATUSES.includes(b.toStatus)) return sendError(res, 400, '无效的目标状态');
  if (b.eventDate !== undefined && b.eventDate !== null && !isValidDate(b.eventDate)) {
    return sendError(res, 400, '事件日期格式无效');
  }
  try {
    const updated = await store.changeEquipmentStatus(id, {
      toStatus: b.toStatus,
      operatorId: req.user.id,
      description: typeof b.description === 'string' ? b.description.trim() : '',
      eventDate: b.eventDate || null,
      cost: b.cost ? Number(b.cost) : 0,
    });
    res.json({ data: updated });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return sendError(res, 404, '设备不存在');
    if (err.message === 'INVALID_STATUS') return sendError(res, 400, '无效的目标状态');
    if (err.message === 'SCRAPPED_CANNOT_CHANGE') return sendError(res, 400, '已报废设备无法变更状态');
    if (err.message === 'INVALID_TRANSITION') return sendError(res, 400, '非法的状态流转');
    throw err;
  }
}));

router.post('/:id/scrap', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的设备 ID');
  const b = req.body || {};
  if (b.eventDate !== undefined && b.eventDate !== null && !isValidDate(b.eventDate)) {
    return sendError(res, 400, '报废日期格式无效');
  }
  try {
    const updated = await store.scrapEquipment(id, {
      operatorId: req.user.id,
      description: typeof b.description === 'string' ? b.description.trim() : '申请报废',
      eventDate: b.eventDate || null,
    });
    res.json({ data: updated });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return sendError(res, 404, '设备不存在');
    if (err.message === 'SCRAPPED_CANNOT_CHANGE') return sendError(res, 400, '设备已报废');
    if (err.message === 'INVALID_TRANSITION') return sendError(res, 400, '非法的状态流转');
    throw err;
  }
}));

module.exports = router;
