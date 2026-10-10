import os
from pathlib import Path
from datetime import timedelta
from decouple import config as env_config
from corsheaders.defaults import default_headers

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = env_config('SECRET_KEY', default='django-insecure-dev-key-change-in-prod-solodev-2026')
DEBUG = env_config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = env_config('ALLOWED_HOSTS', default='*').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'core',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': env_config('SQLITE_PATH', default=str(BASE_DIR / 'db.sqlite3')),
    }
}

AUTH_USER_MODEL = 'core.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

def _parse_origins(raw: str) -> list[str]:
    # Strip whitespace, drop empties and trailing slashes so
    # "http://localhost:3000 " or "http://localhost:3000/" still match.
    seen: list[str] = []
    for part in (raw or '').split(','):
        origin = part.strip().rstrip('/')
        if origin and origin not in seen:
            seen.append(origin)
    return seen


CORS_ALLOWED_ORIGINS = _parse_origins(env_config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5174,http://127.0.0.1:5174,app://solodev',
))
# Dev convenience: allow any localhost/127.0.0.1 port (Vite/Express wrappers
# pick dynamic ports). In production (DEBUG=False) the explicit allow-list
# above is enforced. This fixes "No 'Access-Control-Allow-Origin'" when the
# frontend runs on an origin missing from .env.
CORS_ALLOW_ALL_ORIGINS = env_config('CORS_ALLOW_ALL_ORIGINS', default=DEBUG, cast=bool)
CORS_ALLOW_CREDENTIALS = True
# Keep the package's supported defaults in sync with django-cors-headers and
# explicitly permit the desktop build identity header used for mismatch checks.
CORS_ALLOW_HEADERS = [*default_headers, 'x-solodev-frontend-build']
CORS_ALLOW_METHODS = ['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT']

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ),
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.StandardPagination',
    'PAGE_SIZE': 10,
    'DEFAULT_THROTTLE_RATES': {
        'research': '20/hour',
        'auth': '20/hour',
        'auth_login': '10/hour',
    },
}

# Fail fast on insecure production defaults: never run with the dev
# SECRET_KEY, DEBUG=True, or open ALLOWED_HOSTS outside development.
INSECURE_DEFAULT_KEY = 'django-insecure-dev-key-change-in-prod-solodev-2026'
if not DEBUG:
    if SECRET_KEY == INSECURE_DEFAULT_KEY:
        raise ValueError('SECRET_KEY must be set to a unique value when DEBUG=False.')
    if SECRET_KEY is None or len(str(SECRET_KEY)) < 32:
        raise ValueError('SECRET_KEY must be at least 32 characters when DEBUG=False.')
    if ALLOWED_HOSTS == ['*']:
        raise ValueError('ALLOWED_HOSTS must list explicit hosts when DEBUG=False.')

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=60),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

APP_URL = env_config('APP_URL', default='http://localhost:8000')
POTENTIAL_PROJECTS_ROOT = env_config('POTENTIAL_PROJECTS_ROOT', default=r'D:\projects\potential_projects')
AUTOMATION_RESULTS_ROOT = env_config('AUTOMATION_RESULTS_ROOT', default=r'D:\projects\automations')
