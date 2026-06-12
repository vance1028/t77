'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendError, isNonEmptyString, toPositiveInt, isValidDate } = require('../utils/http');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const VALID_TYPES = ['MAINTENANCE', 'REPAIR'];
const VALID_RESULTS = ['PENDING', 'DONE', 'PARTIAL'];

router.use(authRequired);

router.get('/', wrap(async (req, res) => {
  const { equipmentId, recordType, result } = req.query;
  const filter = {};
  if (equipmentId !== undefined) {
    const eid = toPositiveInt(equipmentId);
    if (eid === null) return sendError(res, 400, '无效的设备 ID');
    filter.equipmentId = eid;
  }
  if (recordType !== undefined) {
    if (!VALID_TYPES.includes(recordType)) return sendError(res, 400, '无效的记录类型');
    filter.recordType = recordType;
  }
  if (result !== undefined) {
    if (!VALID_RESULTS.includes(result)) return sendError(res, 400, '无效的处理结果');
    filter.result = result;
  }
  const list = await store.listMaintenanceRecords(filter);
  res.json({ data: list, total: list.length });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的记录 ID');
  const m = await store.getMaintenanceRecord(id);
  if (!m) return sendError(res, 404, '维护/维修记录不存在');
  res.json({ data: m });
}));

router.get('/:id/parts', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的记录 ID');
  if (!(await store.getMaintenanceRecord(id))) return sendError(res, 404, '维护/维修记录不存在');
  const list = await store.listPartsUsedByMaintenance(id);
  res.json({ data: list, total: list.length });
}));

router.post('/', requireRole('ADMIN', 'MANAGER', 'INSPECTOR'), wrap(async (req, res) => {
  const b = req.body || {};
  const equipmentId = toPositiveInt(b.equipmentId);
  if (equipmentId === null) return sendError(res, 400, '必须指定有效的设备 ID');
  if (!VALID_TYPES.includes(b.recordType)) return sendError(res, 400, '记录类型只能是 MAINTENANCE 或 REPAIR');
  if (!isValidDate(b.startDate)) return sendError(res, 400, '开始日期格式必须为 YYYY-MM-DD');
  if (b.endDate !== undefined && b.endDate !== null && !isValidDate(b.endDate)) {
    return sendError(res, 400, '结束日期格式必须为 YYYY-MM-DD');
  }
  if (b.result !== undefined && !VALID_RESULTS.includes(b.result)) {
    return sendError(res, 400, '处理结果无效');
  }
  let parts = [];
  if (b.parts !== undefined) {
    if (!Array.isArray(b.parts)) return sendError(res, 400, '用件列表必须是数组');
    parts = b.parts;
    for (const p of parts) {
      const pid = Number(p.sparePartId);
      const qty = Number(p.qty);
      if (!pid || !Number.isInteger(pid) || pid <= 0) {
        return sendError(res, 400, '无效的备件 ID');
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        return sendError(res, 400, '备件数量必须是正整数');
      }
    }
  }
  try {
    const operatorId = b.operatorId ? toPositiveInt(b.operatorId) : req.user.id;
    const m = await store.createMaintenanceRecord({
      equipmentId,
      recordType: b.recordType,
      startDate: b.startDate,
      endDate: b.endDate || null,
      operatorId: operatorId || req.user.id,
      faultDesc: typeof b.faultDesc === 'string' ? b.faultDesc.trim() : '',
      actionDesc: typeof b.actionDesc === 'string' ? b.actionDesc.trim() : '',
      result: b.result || 'PENDING',
      parts,
    });
    res.status(201).json({ data: m });
  } catch (err) {
    if (err.message === 'EQUIPMENT_NOT_FOUND') return sendError(res, 404, '设备不存在');
    if (err.message === 'INVALID_TYPE') return sendError(res, 400, '无效的记录类型');
    if (err.message === 'INVALID_PART') return sendError(res, 400, '无效的用件信息');
    if (err.message === 'PART_NOT_FOUND') return sendError(res, 404, '备件不存在');
    if (err.message && err.message.startsWith('PART_INSUFFICIENT')) {
      const pid = err.message.split(':')[1];
      const p = await store.getSparePart(Number(pid));
      return sendError(res, 409, `备件【${p ? p.name : pid}】库存不足`, { sparePartId: Number(pid) });
    }
    throw err;
  }
}));

router.put('/:id', requireRole('ADMIN', 'MANAGER', 'INSPECTOR'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的记录 ID');
  if (!(await store.getMaintenanceRecord(id))) return sendError(res, 404, '维护/维修记录不存在');
  const b = req.body || {};
  const patch = {};
  if (b.startDate !== undefined) {
    if (!isValidDate(b.startDate)) return sendError(res, 400, '开始日期格式无效');
    patch.startDate = b.startDate;
  }
  if (b.endDate !== undefined) {
    if (b.endDate === null || b.endDate === '') {
      patch.endDate = null;
    } else if (!isValidDate(b.endDate)) {
      return sendError(res, 400, '结束日期格式无效');
    } else {
      patch.endDate = b.endDate;
    }
  }
  if (b.result !== undefined) {
    if (!VALID_RESULTS.includes(b.result)) return sendError(res, 400, '处理结果无效');
    patch.result = b.result;
  }
  for (const k of ['faultDesc', 'actionDesc']) {
    if (b[k] !== undefined) patch[k] = String(b[k]).trim();
  }
  const updated = await store.updateMaintenanceRecord(id, patch);
  res.json({ data: updated });
}));

module.exports = router;
