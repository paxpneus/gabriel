import BaseService from '../../../../shared/utils/base-models/base-service';
import User from './user.model';
import userRepository, { UserRepository } from './user.repository';
import { CreateUserInput, UpdateUserInput } from '../../../../shared/schemas';
import bcrypt from 'bcrypt'
import 'dotenv/config'
import jwt from 'jsonwebtoken';
import Role from '../roles/role.model';
const SECRET = process.env.JWT_SECRET!;
import { QueryConfig } from '../../../../shared/query/query.types';
import { cleanDocument } from '../../../../shared/utils/normalizers/document';

export class UserService extends BaseService<User, UserRepository> {
  constructor() {
    super(userRepository);

     this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: 'createdAt',
        sortDir: 'DESC',
      },
      searchFields: [
        'name',
        'email',
      ],
      filterableFields: [
        'role',
        'status',
        'unit_business_id',
      ],
      sortableFields: [
        'name',
        'email',
        'createdAt',
        'updatedAt',
      ],
    }
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

      userDto.cpf = cleanDocument(userDto.cpf)

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

  async login(email: string, password: string) {
    const user = await this.repository.findOne({
      where: { email },
      include: [
        {
          model: Role,
          as: 'role',
          
        }
      ]
    })

    if (!user) throw new Error('Usuário não encontrado')

    const incorrectPassword = await bcrypt.compare(password, user.password)
    if (!incorrectPassword) throw new Error('Senha Incorreta')

      const token = jwt.sign(
        {id: user.id, role: user.role_id},
        SECRET,
        {expiresIn: '8h'}
      )

      return {token, user}
  }
}

export default new UserService();
