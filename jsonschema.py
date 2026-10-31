"""
Minimal self-contained JSON Schema Draft-7 validator compatible with standard jsonschema.
Supports: type, properties, required, items, minItems, maxItems, pattern, enum, const, minimum, maximum.
"""
import re
from typing import Any, Dict


class SchemaError(Exception):
    """Schema definition error."""
    pass


class ValidationError(Exception):
    """Raised when an instance does not match the schema."""
    def __init__(self, message: str, path: str = ""):
        super().__init__(f"{message} at '{path}'" if path else message)
        self.message = message
        self.path = path


def _validate_node(instance: Any, schema: Dict[str, Any], path: str = ""):
    if not isinstance(schema, dict):
        return

    # 1. const check
    if "const" in schema:
        if instance != schema["const"]:
            raise ValidationError(f"Expected const {schema['const']!r}, got {instance!r}", path)

    # 2. enum check
    if "enum" in schema:
        if instance not in schema["enum"]:
            raise ValidationError(f"Value {instance!r} not in enum {schema['enum']!r}", path)

    # 3. type check
    if "type" in schema:
        expected_type = schema["type"]
        type_map = {
            "string": str,
            "integer": int,
            "number": (int, float),
            "boolean": bool,
            "array": list,
            "object": dict,
            "null": type(None),
        }
        if expected_type in type_map:
            expected_cls = type_map[expected_type]
            # In Python, bool is a subclass of int, so handle bool != int
            if expected_type in ("integer", "number") and isinstance(instance, bool):
                raise ValidationError(f"Expected {expected_type}, got boolean", path)
            if not isinstance(instance, expected_cls):
                raise ValidationError(f"Expected type {expected_type}, got {type(instance).__name__}", path)

    # 4. string constraints
    if isinstance(instance, str):
        if "pattern" in schema:
            if not re.search(schema["pattern"], instance):
                raise ValidationError(f"String {instance!r} does not match pattern {schema['pattern']!r}", path)
        if "minLength" in schema and len(instance) < schema["minLength"]:
            raise ValidationError(f"String length {len(instance)} < minLength {schema['minLength']}", path)
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            raise ValidationError(f"String length {len(instance)} > maxLength {schema['maxLength']}", path)

    # 5. number constraints
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            raise ValidationError(f"Value {instance} < minimum {schema['minimum']}", path)
        if "maximum" in schema and instance > schema["maximum"]:
            raise ValidationError(f"Value {instance} > maximum {schema['maximum']}", path)

    # 6. array constraints
    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            raise ValidationError(f"Array length {len(instance)} < minItems {schema['minItems']}", path)
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            raise ValidationError(f"Array length {len(instance)} > maxItems {schema['maxItems']}", path)
        if "items" in schema:
            items_schema = schema["items"]
            for idx, item in enumerate(instance):
                _validate_node(item, items_schema, f"{path}[{idx}]")

    # 7. object constraints
    if isinstance(instance, dict):
        if "required" in schema:
            for req_key in schema["required"]:
                if req_key not in instance:
                    raise ValidationError(f"Missing required property '{req_key}'", path)
        if "properties" in schema:
            props = schema["properties"]
            for k, v in instance.items():
                if k in props:
                    _validate_node(v, props[k], f"{path}.{k}" if path else k)


def validate(instance: Any, schema: Dict[str, Any]):
    """Validate an instance against a JSON Schema Draft-7."""
    _validate_node(instance, schema, "")
