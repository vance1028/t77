'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendError, isNonEmptyString, toPositiveInt, isValidDate } = require('../utils/http');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const VALID_CATEGORIES = ['FILTER', 'SEAL', 'BEARING', 'IMPELLER', 'BELT', 'LUBRICANT', 'ELECTRIC', 'INSTRUMENT', 'OTHER'];
const VALID_REASONS = ['PURCHASE', 'MAINTENANCE', 'REPAIR', 'ADJUST', 'RETURN'];
const VALID_TYPES = ['IN', 'OUT'];

router.use(authRequired);

router.get('/', wrap(async (req, res) => {
  const { category, keyword, stockStatus } = req.query;
  const filter = {};
  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) return sendError(res, 400, '无效的备件类别');
    filter.category = category;
  }
  if (isNonEmptyString(keyword)) filter.keyword = keyword.trim();
  if (stockStatus !== undefined && !['NORMAL', 'LOW_STOCK', 'OUT_OF_STOCK'].includes(stockStatus)) {
    return sendError(res, 400, '无效的库存状态');
  }
  filter.stockStatus = stockStatus;
  const list = await store.listSpareParts(filter);
  res.json({ data: list, total: list.length });
}));

router.get('/low-stock', wrap(async (req, res) => {
  const list = await store.listLowStockSpareParts();
  res.json({ data: list, total: list.length });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  const s = await store.getSparePart(id);
  if (!s) return sendError(res, 404, '备件不存在');
  res.json({ data: s });
}));

router.get('/:id/verify', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  if (!(await store.getSparePart(id))) return sendError(res, 404, '备件不存在');
  const info = await store.verifySparePartStock(id);
  res.json({ data: info });
}));

router.get('/:id/movements', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  if (!(await store.getSparePart(id))) return sendError(res, 404, '备件不存在');
  const list = await store.listSparePartMovements({ sparePartId: id });
  res.json({ data: list, total: list.length });
}));

router.get('/:id/maintenances', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  if (!(await store.getSparePart(id))) return sendError(res, 404, '备件不存在');
  const list = await store.listMaintenancesBySparePart(id);
  res.json({ data: list, total: list.length });
}));

router.post('/', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.code)) return sendError(res, 400, '备件编码不能为空');
  if (!isNonEmptyString(b.name)) return sendError(res, 400, '备件名称不能为空');
  if (b.category !== undefined && !VALID_CATEGORIES.includes(b.category)) {
    return sendError(res, 400, '无效的备件类别');
  }
  if (b.safetyStock !== undefined && (!Number.isInteger(Number(b.safetyStock)) || Number(b.safetyStock) < 0)) {
    return sendError(res, 400, '安全库存必须是非负整数');
  }
  if (b.unitPrice !== undefined && Number(b.unitPrice) < 0) {
    return sendError(res, 400, '单价不能为负');
  }
  if (await store.findSparePartByCode(String(b.code).trim())) {
    return sendError(res, 409, '备件编码已存在');
  }
  const s = await store.createSparePart({
    code: String(b.code).trim(),
    name: String(b.name).trim(),
    category: b.category,
    specification: typeof b.specification === 'string' ? b.specification.trim() : '',
    unit: typeof b.unit === 'string' && b.unit.trim() ? b.unit.trim() : '个',
    safetyStock: b.safetyStock ? Number(b.safetyStock) : undefined,
    unitPrice: b.unitPrice !== undefined ? Number(b.unitPrice) : undefined,
    location: typeof b.location === 'string' ? b.location.trim() : '',
    remark: typeof b.remark === 'string' ? b.remark.trim() : '',
  });
  res.status(201).json({ data: s });
}));

router.put('/:id', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  if (!(await store.getSparePart(id))) return sendError(res, 404, '备件不存在');
  const b = req.body || {};
  const patch = {};
  if (b.code !== undefined) {
    if (!isNonEmptyString(b.code)) return sendError(res, 400, '备件编码不能为空');
    const code = String(b.code).trim();
    const exist = await store.findSparePartByCode(code);
    if (exist && exist.id !== id) return sendError(res, 409, '备件编码已存在');
    patch.code = code;
  }
  if (b.name !== undefined) {
    if (!isNonEmptyString(b.name)) return sendError(res, 400, '备件名称不能为空');
    patch.name = String(b.name).trim();
  }
  if (b.category !== undefined) {
    if (!VALID_CATEGORIES.includes(b.category)) return sendError(res, 400, '无效的备件类别');
    patch.category = b.category;
  }
  for (const k of ['specification', 'unit', 'location', 'remark']) {
    if (b[k] !== undefined) patch[k] = String(b[k]).trim();
  }
  if (b.safetyStock !== undefined) {
    const n = Number(b.safetyStock);
    if (!Number.isInteger(n) || n < 0) return sendError(res, 400, '安全库存必须是非负整数');
    patch.safetyStock = n;
  }
  if (b.unitPrice !== undefined) {
    const n = Number(b.unitPrice);
    if (n < 0) return sendError(res, 400, '单价不能为负');
    patch.unitPrice = n;
  }
  const updated = await store.updateSparePart(id, patch);
  res.json({ data: updated });
}));

router.delete('/:id', requireRole('ADMIN'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  if (!(await store.getSparePart(id))) return sendError(res, 404, '备件不存在');
  await store.deleteSparePart(id);
  res.status(204).end();
}));

router.post('/:id/stock-in', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  const b = req.body || {};
  const qty = Number(b.qty);
  if (!Number.isInteger(qty) || qty <= 0) return sendError(res, 400, '入库数量必须是正整数');
  if (b.reason !== undefined && !VALID_REASONS.includes(b.reason)) {
    return sendError(res, 400, '无效的入库原因');
  }
  if (b.unitPrice !== undefined && Number(b.unitPrice) < 0) {
    return sendError(res, 400, '入库单价不能为负');
  }
  try {
    const result = await store.stockIn({
      sparePartId: id, qty,
      unitPrice: b.unitPrice !== undefined ? Number(b.unitPrice) : null,
      reason: b.reason || 'PURCHASE',
      operatorId: req.user.id,
      remark: typeof b.remark === 'string' ? b.remark.trim() : '',
    });
    res.json({ data: result });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return sendError(res, 404, '备件不存在');
    if (err.message === 'INVALID_QTY') return sendError(res, 400, '入库数量必须是正整数');
    if (err.message === 'INVALID_REASON') return sendError(res, 400, '无效的入库原因');
    throw err;
  }
}));

router.post('/:id/stock-out', requireRole('ADMIN', 'MANAGER', 'INSPECTOR'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的备件 ID');
  const b = req.body || {};
  const qty = Number(b.qty);
  if (!Number.isInteger(qty) || qty <= 0) return sendError(res, 400, '出库数量必须是正整数');
  if (b.reason !== undefined && !VALID_REASONS.includes(b.reason)) {
    return sendError(res, 400, '无效的出库原因');
  }
  try {
    const result = await store.stockOut({
      sparePartId: id, qty,
      reason: b.reason || 'MAINTENANCE',
      operatorId: req.user.id,
      remark: typeof b.remark === 'string' ? b.remark.trim() : '',
    });
    res.json({ data: result });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return sendError(res, 404, '备件不存在');
    if (err.message === 'INVALID_QTY') return sendError(res, 400, '出库数量必须是正整数');
    if (err.message === 'INVALID_REASON') return sendError(res, 400, '无效的出库原因');
    if (err.message === 'INSUFFICIENT_STOCK') return sendError(res, 409, '库存不足，无法出库');
    throw err;
  }
}));

router.get('/movements/list/all', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const { movementType, movementReason } = req.query;
  const filter = {};
  if (movementType !== undefined) {
    if (!VALID_TYPES.includes(movementType)) return sendError(res, 400, '无效的流水类型');
    filter.movementType = movementType;
  }
  if (movementReason !== undefined) {
    if (!VALID_REASONS.includes(movementReason)) return sendError(res, 400, '无效的流水原因');
    filter.movementReason = movementReason;
  }
  const list = await store.listSparePartMovements(filter);
  res.json({ data: list, total: list.length });
}));

module.exports = router;
