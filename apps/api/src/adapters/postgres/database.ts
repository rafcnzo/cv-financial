import postgres from 'postgres';
import type {Env} from '../../env';
export type Db = postgres.Sql;
export type Tx = postgres.TransactionSql;
export function connect(env:Env, system=false) {
 const sql=postgres((system?env.AUTH_HYPERDRIVE:env.HYPERDRIVE).connectionString,{max:1,fetch_types:false,prepare:true});
 return {sql};
}
export async function tenant<T>(db:Db,userId:string,fn:(tx:Tx)=>Promise<T>):Promise<T> {
 return await db.begin(async tx=>{await tx`select set_config('app.user_id',${userId},true)`;return fn(tx);}) as T;
}
