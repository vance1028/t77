-- 人防工程管理平台 - 表结构（MySQL）

-- 用户（登录与角色）
CREATE TABLE IF NOT EXISTS users (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    username      VARCHAR(64)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(64)  NOT NULL DEFAULT '',
    role          VARCHAR(16)  NOT NULL DEFAULT 'INSPECTOR',
    department    VARCHAR(128) NOT NULL DEFAULT '',
    status        VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 人防工程档案
CREATE TABLE IF NOT EXISTS projects (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    code            VARCHAR(48)  NOT NULL,
    name            VARCHAR(128) NOT NULL,
    type            VARCHAR(32)  NOT NULL DEFAULT 'COMBINED',
    protection_level VARCHAR(16) NOT NULL DEFAULT '6',
    area_sqm        DECIMAL(12,2) NOT NULL DEFAULT 0,
    address         VARCHAR(255) NOT NULL DEFAULT '',
    district        VARCHAR(64)  NOT NULL DEFAULT '',
    peacetime_use   VARCHAR(128) NOT NULL DEFAULT '',
    status          VARCHAR(16)  NOT NULL DEFAULT 'NORMAL',
    completed_at    DATE         NULL,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_projects_code (code),
    KEY idx_projects_status (status),
    KEY idx_projects_district (district)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 工程内的设备设施（扩展为全生命周期管理）
CREATE TABLE IF NOT EXISTS equipments (
    id                  BIGINT       NOT NULL AUTO_INCREMENT,
    project_id          BIGINT       NOT NULL,
    name                VARCHAR(128) NOT NULL,
    category            VARCHAR(32)  NOT NULL DEFAULT 'OTHER',
    model               VARCHAR(64)  NOT NULL DEFAULT '',
    serial_no           VARCHAR(64)  NOT NULL DEFAULT '',
    install_date        DATE         NULL,
    commission_date    DATE         NULL COMMENT '启用日期',
    design_life_years   INT          NOT NULL DEFAULT 15 COMMENT '设计使用年限（年）',
    warranty_end_date  DATE         NULL COMMENT '保修截止日期',
    last_maintain_date DATE         NULL COMMENT '上次维护日期',
    maintain_cycle_days INT         NOT NULL DEFAULT 180 COMMENT '维护周期（天）',
    status              VARCHAR(16)  NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL/FAULT/MAINTENANCE/SCRAPPED',
    remark              VARCHAR(500) NOT NULL DEFAULT '',
    created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_equip_project (project_id),
    KEY idx_equip_status (status),
    KEY idx_equip_commission (commission_date),
    KEY idx_equip_warranty (warranty_end_date),
    CONSTRAINT fk_equip_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 设备履历（状态流转、维护、维修、报废全留痕）
CREATE TABLE IF NOT EXISTS equipment_histories (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    equipment_id    BIGINT       NOT NULL,
    event_type      VARCHAR(32)  NOT NULL COMMENT 'COMMISSION/STATUS_CHANGE/MAINTENANCE/REPAIR/SCRAP',
    from_status     VARCHAR(16)  NULL,
    to_status       VARCHAR(16)  NULL,
    event_date      DATE         NOT NULL,
    operator_id     BIGINT       NULL,
    description     VARCHAR(1000) NOT NULL DEFAULT '',
    cost            DECIMAL(12,2) NOT NULL DEFAULT 0,
    reference_id    BIGINT       NULL COMMENT '关联维修/维护记录ID',
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_hist_equipment (equipment_id),
    KEY idx_hist_event_date (event_date),
    KEY idx_hist_event_type (event_type),
    CONSTRAINT fk_hist_equipment FOREIGN KEY (equipment_id) REFERENCES equipments (id) ON DELETE CASCADE,
    CONSTRAINT fk_hist_operator FOREIGN KEY (operator_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 备品备件库存
CREATE TABLE IF NOT EXISTS spare_parts (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    code            VARCHAR(48)  NOT NULL,
    name            VARCHAR(128) NOT NULL,
    category        VARCHAR(32)  NOT NULL DEFAULT 'OTHER',
    specification   VARCHAR(128) NOT NULL DEFAULT '',
    unit            VARCHAR(16)  NOT NULL DEFAULT '个',
    stock_qty       INT          NOT NULL DEFAULT 0,
    safety_stock    INT          NOT NULL DEFAULT 5,
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
    location        VARCHAR(128) NOT NULL DEFAULT '',
    remark          VARCHAR(500) NOT NULL DEFAULT '',
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_spare_code (code),
    KEY idx_spare_category (category),
    KEY idx_spare_stock (stock_qty)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 备件出入库流水
CREATE TABLE IF NOT EXISTS spare_part_movements (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    spare_part_id   BIGINT       NOT NULL,
    movement_type   VARCHAR(16)  NOT NULL COMMENT 'IN/OUT',
    movement_reason VARCHAR(32)  NOT NULL COMMENT 'PURCHASE/MAINTENANCE/REPAIR/ADJUST/RETURN',
    qty             INT          NOT NULL,
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
    stock_before    INT          NOT NULL,
    stock_after     INT          NOT NULL,
    reference_id    BIGINT       NULL COMMENT '关联维修记录/采购单号等',
    operator_id     BIGINT       NULL,
    remark          VARCHAR(500) NOT NULL DEFAULT '',
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_move_spare (spare_part_id),
    KEY idx_move_type (movement_type),
    KEY idx_move_created (created_at),
    CONSTRAINT fk_move_spare FOREIGN KEY (spare_part_id) REFERENCES spare_parts (id),
    CONSTRAINT fk_move_operator FOREIGN KEY (operator_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 维修/维护记录
CREATE TABLE IF NOT EXISTS maintenance_records (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    equipment_id    BIGINT       NOT NULL,
    record_type     VARCHAR(16)  NOT NULL COMMENT 'MAINTENANCE/REPAIR',
    start_date      DATE         NOT NULL,
    end_date        DATE         NULL,
    operator_id     BIGINT       NULL,
    fault_desc      VARCHAR(1000) NOT NULL DEFAULT '',
    action_desc     VARCHAR(1000) NOT NULL DEFAULT '',
    result          VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/DONE/PARTIAL',
    total_cost      DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_maint_equipment (equipment_id),
    KEY idx_maint_type (record_type),
    KEY idx_maint_start (start_date),
    KEY idx_maint_result (result),
    CONSTRAINT fk_maint_equipment FOREIGN KEY (equipment_id) REFERENCES equipments (id) ON DELETE CASCADE,
    CONSTRAINT fk_maint_operator FOREIGN KEY (operator_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 维修用件明细
CREATE TABLE IF NOT EXISTS maintenance_parts (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    maintenance_id    BIGINT       NOT NULL,
    spare_part_id     BIGINT       NOT NULL,
    qty               INT          NOT NULL,
    unit_price        DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal          DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_maint_part (maintenance_id, spare_part_id),
    KEY idx_mp_spare (spare_part_id),
    CONSTRAINT fk_mp_maint FOREIGN KEY (maintenance_id) REFERENCES maintenance_records (id) ON DELETE CASCADE,
    CONSTRAINT fk_mp_spare FOREIGN KEY (spare_part_id) REFERENCES spare_parts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 检查/维护记录
CREATE TABLE IF NOT EXISTS inspections (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    project_id   BIGINT       NOT NULL,
    inspector_id BIGINT       NULL,
    inspect_date DATE         NOT NULL,
    type         VARCHAR(16)  NOT NULL DEFAULT 'ROUTINE',
    result       VARCHAR(16)  NOT NULL DEFAULT 'PASS',
    issues       VARCHAR(1000) NOT NULL DEFAULT '',
    created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_insp_project (project_id),
    KEY idx_insp_date (inspect_date),
    CONSTRAINT fk_insp_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_insp_user FOREIGN KEY (inspector_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
