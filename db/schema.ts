import {integer,sqliteTable,text,index,primaryKey} from 'drizzle-orm/sqlite-core';
export const flows=sqliteTable('flows',{id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),project:text('project').notNull(),document:text('document').notNull(),revision:integer('revision').notNull().default(1),updatedAt:text('updated_at').notNull()},t=>[index('flows_owner_idx').on(t.owner)]);
export const assets=sqliteTable('assets',{id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),mime:text('mime').notNull(),createdAt:text('created_at').notNull()});

export const flowHistory=sqliteTable('flow_history',{owner:text('owner').notNull(),flowId:text('flow_id').notNull(),revision:integer('revision').notNull(),document:text('document').notNull(),createdAt:text('created_at').notNull()},t=>[primaryKey({columns:[t.owner,t.flowId,t.revision]})]);
