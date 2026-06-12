'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendError, isNonEmptyString, toPositiveInt } = require('../utils/http');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const VALID_STATUS = ['NORMAL', 'MAINTENANCE', 'DECOMMISSIONED'];

// 所有工程接口都要登录
router.use(authRequired);

// 列表（支持 status / district / keyword 筛选）
router.get('/', wrap(async (req, res) => {
  const { status, district, keyword } = req.query;
  const filters = {};
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return sendError(res, 400, '无效的工程状态');
    filters.status = status;
  }
  if (isNonEmptyString(district)) filters.district = district.trim();
  if (isNonEmptyString(keyword)) filters.keyword = keyword.trim();
  const list = await store.listProjects(filters);
  res.json({ data: list, total: list.length });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  const p = await store.getProject(id);
  if (!p) return sendError(res, 404, '人防工程不存在');
  res.json({ data: p });
}));

// 新建工程（管理员/工程管理员可建）
router.post('/', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.code)) return sendError(res, 400, '工程编号不能为空');
  if (!isNonEmptyString(b.name)) return sendError(res, 400, '工程名称不能为空');
  if (b.status !== undefined && !VALID_STATUS.includes(b.status)) {
    return sendError(res, 400, '无效的工程状态');
  }
  if (await store.findProjectByCode(b.code.trim())) {
    return sendError(res, 409, '工程编号已存在');
  }
  const p = await store.createProject({ ...b, code: b.code.trim(), name: b.name.trim() });
  res.status(201).json({ data: p });
}));

// 更新工程
router.put('/:id', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  const b = req.body || {};
  if (b.name !== undefined && !isNonEmptyString(b.name)) return sendError(res, 400, '工程名称不能为空');
  if (b.status !== undefined && !VALID_STATUS.includes(b.status)) {
    return sendError(res, 400, '无效的工程状态');
  }
  const updated = await store.updateProject(id, b);
  res.json({ data: updated });
}));

// 删除工程（仅管理员）
router.delete('/:id', requireRole('ADMIN'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  await store.deleteProject(id);
  res.status(204).end();
}));

/* ---------- 工程下的设备设施 ---------- */

router.get('/:id/equipments', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  res.json({ data: await store.listEquipments(id) });
}));

router.post('/:id/equipments', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  const b = req.body || {};
  if (!isNonEmptyString(b.name)) return sendError(res, 400, '设备名称不能为空');
  const VALID_EQ_STATUSES = ['NORMAL', 'FAULT', 'MAINTENANCE', 'SCRAPPED'];
  const VALID_CATEGORIES = ['PROTECTIVE_DOOR', 'VENTILATION', 'POWER', 'WATER', 'OTHER'];
  if (b.status !== undefined && !VALID_EQ_STATUSES.includes(b.status)) {
    return sendError(res, 400, '无效的设备状态');
  }
  if (b.category !== undefined && !VALID_CATEGORIES.includes(b.category)) {
    return sendError(res, 400, '无效的设备类别');
  }
  if (b.designLifeYears !== undefined && (!Number.isInteger(Number(b.designLifeYears)) || Number(b.designLifeYears) <= 0)) {
    return sendError(res, 400, '设计使用年限必须是正整数');
  }
  if (b.maintainCycleDays !== undefined && (!Number.isInteger(Number(b.maintainCycleDays)) || Number(b.maintainCycleDays) <= 0)) {
    return sendError(res, 400, '维护周期必须是正整数天数');
  }
  const e = await store.createEquipment({
    ...b, projectId: id,
    name: b.name.trim(),
    designLifeYears: b.designLifeYears ? Number(b.designLifeYears) : undefined,
    maintainCycleDays: b.maintainCycleDays ? Number(b.maintainCycleDays) : undefined,
  });
  res.status(201).json({ data: e });
}));

module.exports = router;
