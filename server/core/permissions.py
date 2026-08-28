from rest_framework import permissions

class IsOwner(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        # Direct owner field
        if hasattr(obj, 'owner'):
            return obj.owner_id == user.id
        # Project relation
        if hasattr(obj, 'project'):
            # Milestone, Task, TimeEntry through project
            if hasattr(obj.project, 'owner_id'):
                return obj.project.owner_id == user.id
        # Subtask through task.project
        if hasattr(obj, 'task'):
            if hasattr(obj.task, 'project') and hasattr(obj.task.project, 'owner_id'):
                return obj.task.project.owner_id == user.id
        return False
