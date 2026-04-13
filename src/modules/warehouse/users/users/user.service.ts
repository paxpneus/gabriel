import BaseService from '../../../../shared/utils/base-models/base-service';
import User from './user.model';
import userRepository, { UserRepository } from './user.repository';
import { UserCreationAttributes } from './user.types';
import { CreateUserSchema, UpdateUserSchema, CreateUserInput, UpdateUserInput } from '../../../../shared/schemas';

export class UserService extends BaseService<User, UserRepository> {
  constructor() {
    super(userRepository);
  }

  async createUserWithValidation(userDto: CreateUserInput): Promise<User> {
    
    
      const existingUser = await this.repository.findOne({ where: { email: userDto.email } });
      if (existingUser) {
        throw new Error('Usuário com este email já existe');
      }

      const cpfExists = await this.repository.findOne({ where: { cpf: userDto.cpf } });
      if (cpfExists) {
        throw new Error('Usuário com este CPF já existe');
      }

      return await this.repository.create(userDto);
    
  }


  async updateUserWithValidation(userId: string, userDto: UpdateUserInput): Promise<User | null> {


      if (userDto.email) {
        const existingUser = await this.repository.findOne({ 
          where: { email: userDto.email } 
        });
        if (existingUser && existingUser.id !== userId) {
          throw new Error('Outro usuário já possui este email');
        }
      }

      if (userDto.cpf) {
        const cpfExists = await this.repository.findOne({ 
          where: { cpf: userDto.cpf } 
        });
        if (cpfExists && cpfExists.id !== userId) {
          throw new Error('Outro usuário já possui este CPF');
        }
      }

      return await this.repository.update(userId, userDto);
    
  }
}

export default new UserService();
