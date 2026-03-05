import { join, resolve, dirname, sep } from "path";
console.log(join(dirname('a/b'), 'c'), resolve('a', 'b'), sep);
