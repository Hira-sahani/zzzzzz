import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWTPayload, UserType } from '../types';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_change_this';

/**
 * Middleware to verify JWT token and attach user to request
 */
export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Access token required',
      code: 'MISSING_TOKEN'
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
    return;
  }
};

/**
 * Middleware to check if user has specific user type
 */
export const requireUserType = (...allowedTypes: UserType[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    if (!allowedTypes.includes(req.user.userType)) {
      res.status(403).json({
        success: false,
        error: 'Access forbidden: insufficient permissions',
        code: 'FORBIDDEN'
      });
      return;
    }

    next();
  };
};

/**
 * Generate JWT token for user
 */
export const generateToken = (userId: number, phone: string, userType: UserType): string => {
  const payload: JWTPayload = {
    userId,
    phone,
    userType
  };

  const expiry: string | number = process.env.JWT_EXPIRY || '30d';
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiry } as jwt.SignOptions);
};

/**
 * Optional authentication - attaches user if token exists but doesn't require it
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
      req.user = decoded;
    } catch (error) {
      // Token invalid, but that's okay for optional auth
    }
  }

  next();
};
