// src/services/idGenerator.js
import { v4 as uuidv4 } from 'uuid';

export const generateId = () => {
  return uuidv4(); // Returns something like '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
};