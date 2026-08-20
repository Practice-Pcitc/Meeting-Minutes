import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, NotFoundException } from '@nestjs/common';
import { StateService } from './state.service';
import { Meeting, Person, Entry, TopicTag, Todo, Label, LibraryPerson } from './types';

@Controller('api')
export class StateController {
  constructor(private readonly svc: StateService) {}

  // ===== 整体状态 =====
  @Get('state')
  getState() {
    return this.svc.getState();
  }

  @Post('reset')
  @HttpCode(200)
  reset() {
    return this.svc.reset();
  }

  @Get('meetings')
  listMeetings() {
    return this.svc.listMeetings();
  }

  @Post('meetings')
  createMeeting(@Body() body: { title?: string; date?: string; startTime?: string; endTime?: string; location?: string; copyPersons?: boolean; copySeats?: boolean; libraryPersonIds?: string[] }) {
    return this.svc.createMeeting(body || {});
  }

  @Post('meetings/:id/select')
  selectMeeting(@Param('id') id: string) {
    const state = this.svc.selectMeeting(id);
    if (!state) throw new NotFoundException('会议不存在');
    return state;
  }

  @Patch('meetings/:id')
  updateMeetingById(@Param('id') id: string, @Body() body: Partial<Meeting>) {
    const meeting = this.svc.updateMeeting(body, id);
    if (!meeting) throw new NotFoundException('会议不存在');
    return meeting;
  }

  @Delete('meetings/:id')
  deleteMeeting(@Param('id') id: string) {
    const state = this.svc.deleteMeeting(id);
    if (!state) throw new NotFoundException('会议不存在');
    return state;
  }

  // ===== 会议元信息 =====
  @Patch('meeting')
  updateMeeting(@Body() body: Partial<Meeting>) {
    return this.svc.updateMeeting(body);
  }

  @Patch('seats/:row/:col')
  updateSeat(
    @Param('row') row: string,
    @Param('col') col: string,
    @Body() body: { personId?: string | null },
  ) {
    return this.svc.updateSeat(Number(row), Number(col), body?.personId || null);
  }

  @Delete('seats')
  clearSeats() {
    return this.svc.clearSeats();
  }

  // ===== 人员 =====
  @Get('persons')
  listPersons() {
    return this.svc.listPersons();
  }

  @Post('persons')
  addPerson(@Body() body: Omit<Person, 'id'>) {
    return this.svc.addPerson(body);
  }

  @Patch('persons/:id')
  updatePerson(@Param('id') id: string, @Body() body: Partial<Person>) {
    const p = this.svc.updatePerson(id, body);
    if (!p) throw new NotFoundException('人员不存在');
    return p;
  }

  @Delete('persons/:id')
  @HttpCode(204)
  removePerson(@Param('id') id: string) {
    if (!this.svc.removePerson(id)) throw new NotFoundException('人员不存在');
  }

  // ===== 系统级人员库 =====
  @Get('person-library')
  listLibrary() {
    return this.svc.listLibrary();
  }

  @Post('person-library')
  addLibraryPerson(@Body() body: Omit<LibraryPerson, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.svc.addLibraryPerson(body);
  }

  @Patch('person-library/:id')
  updateLibraryPerson(@Param('id') id: string, @Body() body: Partial<Omit<LibraryPerson, 'id' | 'createdAt'>>) {
    const p = this.svc.updateLibraryPerson(id, body);
    if (!p) throw new NotFoundException('人员不存在');
    return p;
  }

  @Delete('person-library/:id')
  @HttpCode(204)
  removeLibraryPerson(@Param('id') id: string) {
    if (!this.svc.removeLibraryPerson(id)) throw new NotFoundException('人员不存在');
  }

  // ===== 记录 =====
  @Get('entries')
  listEntries() {
    return this.svc.listEntries();
  }

  @Post('entries')
  addEntry(@Body() body: Omit<Entry, 'id' | 'createdAt'>) {
    return this.svc.addEntry(body);
  }

  @Patch('entries/:id')
  updateEntry(@Param('id') id: string, @Body() body: Partial<Entry>) {
    const e = this.svc.updateEntry(id, body);
    if (!e) throw new NotFoundException('记录不存在');
    return e;
  }

  @Delete('entries/:id')
  @HttpCode(204)
  removeEntry(@Param('id') id: string) {
    if (!this.svc.removeEntry(id)) throw new NotFoundException('记录不存在');
  }

  // ===== 主题 =====
  @Get('topics')
  listTopics() {
    return this.svc.listTopics();
  }

  @Post('topics')
  addTopic(@Body() body: Omit<TopicTag, 'id'>) {
    return this.svc.addTopic(body);
  }

  @Delete('topics/:id')
  @HttpCode(204)
  removeTopic(@Param('id') id: string) {
    if (!this.svc.removeTopic(id)) throw new NotFoundException('主题不存在');
  }

  // ===== 待办 =====
  @Get('todos')
  listTodos() {
    return this.svc.listTodos();
  }

  @Post('todos')
  addTodo(@Body() body: Omit<Todo, 'id' | 'createdAt' | 'done'>) {
    return this.svc.addTodo(body);
  }

  @Patch('todos/:id')
  updateTodo(@Param('id') id: string, @Body() body: Partial<Todo>) {
    const t = this.svc.updateTodo(id, body);
    if (!t) throw new NotFoundException('待办不存在');
    return t;
  }

  @Delete('todos/:id')
  @HttpCode(204)
  removeTodo(@Param('id') id: string) {
    if (!this.svc.removeTodo(id)) throw new NotFoundException('待办不存在');
  }

  // ===== 标签 =====
  @Get('labels')
  listLabels() {
    return this.svc.listLabels();
  }

  @Post('labels')
  addLabel(@Body() body: Omit<Label, 'id'>) {
    return this.svc.addLabel(body);
  }

  @Delete('labels/:id')
  @HttpCode(204)
  removeLabel(@Param('id') id: string) {
    if (!this.svc.removeLabel(id)) throw new NotFoundException('标签不存在');
  }
}
