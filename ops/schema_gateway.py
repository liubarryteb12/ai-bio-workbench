#!/usr/bin/env python3
"""
schema_gateway.py —— 进程外文件 IPC Schema 校验网关（4 Argon 第 74 轮 Q1/Q6 终审裁定）

设计原则：
1. 短命子进程：每次校验独立启动，校验完即退出，杜绝内存泄漏与跨请求状态污染；
2. 文件驱动 IPC：通过 --in <req.json> 与 --out <res.json> 交换数据，严禁走 stdio 管道（防长 JSON 缓冲区死锁）；
3. 三态退出码：
   - 0: ALLOW（校验通过）
   - 2: DENY（数据不合规，res.json 包含字段级错误路径）
   - 1: ERROR（基础设施错误，默认 Fail-Closed 阻断）
4. 防绕过铁律：
   - 当 CI=true 或环境检测为门禁测试时，即使传入 --allow-bypass-on-error 也强制 Exit 1 阻断；
   - 仅在非 CI 交互式环境显式声明 --allow-bypass-on-error 时允许旁路放行，并向回执记录 GATEWAY_BYPASS_TAINTED。
"""

import os
import sys
import json
import argparse
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


class BasicInfoSchema(BaseModel):
    projectName: str = Field(..., min_length=1, description="项目名称")
    diseaseName: str = Field(..., min_length=1, description="疾病名称")
    dataType: str = Field(..., description="数据类型")

    @field_validator("dataType")
    @classmethod
    def validate_data_type(cls, v: str) -> str:
        allowed = {"microarray", "bulk_rnaseq", "scrna", "spatial"}
        if v not in allowed:
            raise ValueError(f"dataType 必须在 {allowed} 中，当前为: {v}")
        return v


class CutoffProfileSchema(BaseModel):
    profile: Optional[str] = "standard"
    log2fc: Optional[float] = 1.0
    p: Optional[float] = 0.05


class RequirementSchema(BaseModel):
    basicInfo: BasicInfoSchema
    datasets: List[Dict[str, Any]] = Field(..., min_length=1, description="数据集列表")
    groups: List[Dict[str, Any]] = Field(..., min_length=1, description="样本分组")
    analysisCutoffs: Optional[Dict[str, Any]] = Field(default_factory=dict)


class ProjectMetaSchema(BaseModel):
    project_id: str = Field(..., min_length=1, description="项目唯一标识符")
    project_name: Optional[str] = Field(None, description="项目人读名称")
    pipeline: Optional[str] = Field(None, description="分析线标识")
    species: Optional[str] = Field("mouse", description="物种")
    created_at: Optional[str] = Field(None, description="创建时间")

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, v: str) -> str:
        if ".." in v or "/" in v or "\\" in v:
            raise ValueError("project_id 包含越界字符")
        return v

    @field_validator("pipeline")
    @classmethod
    def validate_pipeline(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            allowed = {"line1_bulk", "line2_scrna", "line3_spatial"}
            if v not in allowed:
                raise ValueError(f"pipeline 必须在 {allowed} 中，当前为: {v}")
        return v


class RunTaskSchema(BaseModel):
    lineId: str = Field(..., min_length=1, description="分析流水线ID")
    step: str = Field(..., min_length=1, description="步骤ID")
    projectId: str = Field(..., min_length=1, description="项目ID")
    inputs: List[str] = Field(default_factory=list, description="输入文件路径")
    outputs: List[str] = Field(default_factory=list, description="输出文件路径")
    seed: Optional[int] = Field(None, description="随机种子")

    @field_validator("lineId")
    @classmethod
    def validate_line_id(cls, v: str) -> str:
        allowed = {"line1_bulk", "line2_scrna", "line3_spatial"}
        if v not in allowed:
            raise ValueError(f"lineId 必须在 {allowed} 中，当前为: {v}")
        return v


class DataContractSchema(BaseModel):
    input_artifact: Optional[str] = None
    format: Optional[str] = None
    required_columns: List[str] = Field(default_factory=list)
    required_obs_keys: List[str] = Field(default_factory=list)
    required_obsm_keys: List[str] = Field(default_factory=list)


class FigureTemplateV2Schema(BaseModel):
    """Argon 第 75 轮 FigureTemplate v2 四位一体契约（ready/draft 双向互斥锁）。"""
    id: str = Field(..., min_length=3)
    status: str = Field(..., description="ready | draft")
    producing_mod_id: Optional[str] = None
    required_mod_ids: List[str] = Field(default_factory=list)
    data_contract: DataContractSchema = Field(default_factory=DataContractSchema)
    preview_sha256: Optional[str] = None
    render_evidence: Optional[Dict[str, Any]] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in {"ready", "draft"}:
            raise ValueError(f"status 必须为 ready/draft，当前: {v}")
        return v

    @model_validator(mode="after")
    def enforce_status_lock(self):
        if self.status == "ready":
            if not self.producing_mod_id:
                raise ValueError("ready 模板必须具备 producing_mod_id（硬外键）")
            if not self.data_contract.input_artifact:
                raise ValueError("ready 模板 data_contract.input_artifact 不得为空")
            if not self.preview_sha256:
                raise ValueError("ready 模板必须具备 preview_sha256 实证")
        elif self.status == "draft":
            if self.preview_sha256 or self.render_evidence:
                raise ValueError("draft 模板严禁携带 preview_sha256/render_evidence（防伪证）")
        return self


SCHEMAS = {
    "project": ProjectMetaSchema,
    "project_metadata": ProjectMetaSchema,
    "requirement": RequirementSchema,
    "run_task": RunTaskSchema,
    "figure_template": FigureTemplateV2Schema,
}


def write_response(out_path: str, payload: Dict[str, Any]) -> None:
    tmp_path = f"{out_path}.tmp.{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, out_path)


def main():
    parser = argparse.ArgumentParser(description="文件驱动 Schema 校验网关")
    parser.add_argument("--schema", required=True, help="待校验的 Schema 名称")
    parser.add_argument("--in", dest="in_path", required=True, help="输入 JSON 文件路径")
    parser.add_argument("--out", dest="out_path", required=True, help="输出回执 JSON 文件路径")
    parser.add_argument("--allow-bypass-on-error", action="store_true", help="允许在网关出错时降级放行（CI环境强制禁止）")

    args = parser.parse_args()

    is_ci = os.environ.get("CI", "").lower() in ("true", "1") or os.environ.get("NODE_TEST_CONTEXT") is not None

    if args.allow_bypass_on_error and is_ci:
        err_msg = "CI 环境严禁使用 --allow-bypass-on-error 旁路防火墙"
        try:
            write_response(args.out_path, {
                "status": "ERROR",
                "schema": args.schema,
                "errors": [{"path": "", "message": err_msg, "type": "ci_bypass_forbidden"}]
            })
        except Exception:
            pass
        sys.stderr.write(f"[schema_gateway] FATAL: {err_msg}\n")
        sys.exit(1)

    schema_cls = SCHEMAS.get(args.schema)
    if not schema_cls:
        err_msg = f"未注册的 Schema: {args.schema} (可选: {list(SCHEMAS.keys())})"
        try:
            write_response(args.out_path, {
                "status": "ERROR",
                "schema": args.schema,
                "errors": [{"path": "", "message": err_msg, "type": "unknown_schema"}]
            })
        except Exception:
            pass
        sys.stderr.write(f"[schema_gateway] ERROR: {err_msg}\n")
        sys.exit(1)

    if not os.path.exists(args.in_path):
        err_msg = f"输入文件不存在: {args.in_path}"
        try:
            write_response(args.out_path, {
                "status": "ERROR",
                "schema": args.schema,
                "errors": [{"path": "", "message": err_msg, "type": "file_not_found"}]
            })
        except Exception:
            pass
        sys.stderr.write(f"[schema_gateway] ERROR: {err_msg}\n")
        sys.exit(1)

    try:
        with open(args.in_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        err_msg = f"输入 JSON 解析失败: {str(e)}"
        try:
            write_response(args.out_path, {
                "status": "ERROR",
                "schema": args.schema,
                "errors": [{"path": "", "message": err_msg, "type": "json_decode_error"}]
            })
        except Exception:
            pass
        sys.stderr.write(f"[schema_gateway] ERROR: {err_msg}\n")
        sys.exit(1)

    try:
        schema_cls.model_validate(data)
        write_response(args.out_path, {
            "status": "ALLOW",
            "schema": args.schema,
            "errors": []
        })
        sys.exit(0)
    except ValidationError as ve:
        formatted_errors = []
        for err in ve.errors():
            loc = ".".join(str(x) for x in err.get("loc", []))
            formatted_errors.append({
                "path": loc,
                "message": err.get("msg", "验证失败"),
                "type": err.get("type", "validation_error")
            })
        write_response(args.out_path, {
            "status": "DENY",
            "schema": args.schema,
            "errors": formatted_errors
        })
        sys.stderr.write(f"[schema_gateway] DENY: 数据校验失败 ({len(formatted_errors)} 处错误)\n")
        sys.exit(2)
    except Exception as ex:
        err_msg = f"网关内部异常: {str(ex)}"
        write_response(args.out_path, {
            "status": "ERROR",
            "schema": args.schema,
            "errors": [{"path": "", "message": err_msg, "type": "internal_error"}]
        })
        sys.stderr.write(f"[schema_gateway] ERROR: {err_msg}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
