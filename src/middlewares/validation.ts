import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ParamsDictionary } from 'express-serve-static-core'
import QueryString from 'qs';
/**
 * Middleware para validação de dados usando Zod
 * Pode ser usado para validar body, params ou query
 */
export const validateData = (schema: ZodSchema, source: 'body' | 'params' | 'query' = 'body') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dataToValidate = source === 'body' ? req.body : source === 'params' ? req.params : req.query;

      // Valida os dados contra o schema
      const validatedData = await schema.parseAsync(dataToValidate);

      // Substitui os dados originais pelos dados validados
      if (source === 'body') {
        req.body = validatedData;
      } else if (source === 'params') {
        req.params = validatedData as ParamsDictionary;
      } else {
        req.query = validatedData as QueryString.ParsedQs;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map((issue) => ({
          field: issue.path.join('.') || 'unknown',
          message: issue.message,
          code: issue.code,
        }));

        return res.status(400).json({
          success: false,
          errors: issues,
          message: 'Erro na validação dos dados',
        });
      }
      console.error('Validation middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao processar validação',
      });
    }
  };
};

/**
 * Middleware para validação específica de criação
 * Valida body com schema de criação
 */
export const validateCreate = (schema: ZodSchema) => validateData(schema, 'body');

/**
 * Middleware para validação específica de atualização
 * Valida body com schema de atualização (campos opcionais)
 */
export const validateUpdate = (schema: ZodSchema) => validateData(schema, 'body');

/**
 * Middleware para validação de ID
 * Valida params com schema de ID
 */
export const validateId = (schema: ZodSchema) => validateData(schema, 'params');

/**
 * Middleware para validação de query parameters
 */
export const validateQuery = (schema: ZodSchema) => validateData(schema, 'query');
