import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

// Attach roles to routes: @Roles('admin', 'security')
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) =>
    (target: any, key?: string, descriptor?: any) => {
        Reflect.defineMetadata(ROLES_KEY, roles, descriptor?.value ?? target);
        return descriptor ?? target;
    };

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') { }

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!requiredRoles) return true;
        const { user } = context.switchToHttp().getRequest();
        if (!requiredRoles.includes(user.role)) {
            throw new ForbiddenException('Please contact the workspace admin for this request');
        }
        return true;
    }
}
