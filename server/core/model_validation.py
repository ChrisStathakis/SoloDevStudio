import re


# Human-readable model names may contain spaces, while shell metacharacters
# remain blocked because the value is passed to a local CLI command.
MODEL_ID_PATTERN = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9 ._:/-]*[A-Za-z0-9])?')
MODEL_ID_ERROR = 'Model IDs or names may contain only letters, numbers, spaces, ., _, :, /, and -.'


def is_safe_model_id(value):
    return bool(isinstance(value, str) and MODEL_ID_PATTERN.fullmatch(value.strip()))
