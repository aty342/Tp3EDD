import fs from "fs";
import { v1 as uuidv1 } from "uuid";
import * as utilities from "../utilities.js";
import { log } from "../log.js";
import RepositoryCachesManager from "./repositoryCachesManager.js";
import { isSet } from "util/types";

globalThis.jsonFilesPath = "jsonFiles";
globalThis.repositoryEtags = {};


export default class Repository {
    constructor(ModelClass, cached = true) {
        this.objectsList = null;
        this.model = ModelClass;
        this.objectsName = ModelClass.getClassName() + "s";
        this.objectsFile = `./jsonFiles/${this.objectsName}.json`;
        this.initEtag();
        this.cached = cached;
    }
    initEtag() {
        if (this.objectsName in repositoryEtags)
            this.ETag = repositoryEtags[this.objectsName];
        else this.newETag();
    }
    newETag() {
        this.ETag = uuidv1();
        repositoryEtags[this.objectsName] = this.ETag;
    }
    objects() {
        if (this.objectsList == null) this.read();
        return this.objectsList;
    }
    read() {
        this.objectsList = null;
        if (this.cached) {
            this.objectsList = RepositoryCachesManager.find(this.objectsName);
        }
        if (this.objectsList == null) {
            try {
                let rawdata = fs.readFileSync(this.objectsFile);
                // we assume here that the json data is formatted correctly
                this.objectsList = JSON.parse(rawdata);
                if (this.cached)
                    RepositoryCachesManager.add(this.objectsName, this.objectsList);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    // file does not exist, it will be created on demand
                    log(FgYellow, `Warning ${this.objectsName} repository does not exist. It will be created on demand`);
                    this.objectsList = [];
                } else {
                    log(FgRed, `Error while reading ${this.objectsName} repository`);
                    log(FgRed, '--------------------------------------------------');
                    log(FgRed, error);
                }
            }
        }
    }
    write() {
        this.newETag();
        fs.writeFileSync(this.objectsFile, JSON.stringify(this.objectsList));
        if (this.cached) {
            RepositoryCachesManager.add(this.objectsName, this.objectsList);
        }
    }
    nextId() {
        let maxId = 0;
        for (let object of this.objects()) {
            if (object.Id > maxId) {
                maxId = object.Id;
            }
        }
        return maxId + 1;
    }
    checkConflict(instance) {
        let conflict = false;
        if (this.model.key)
            conflict = this.findByField(this.model.key, instance[this.model.key], instance.Id) != null;
        if (conflict) {
            this.model.addError(`Unicity conflict on [${this.model.key}]...`);
            this.model.state.inConflict = true;
        }
        return conflict;
    }
    add(object) {
        delete object.Id;
        object = { "Id": 0, ...object };
        this.model.validate(object);
        if (this.model.state.isValid) {
            this.checkConflict(object);
            if (!this.model.state.inConflict) {
                object.Id = this.nextId();
                this.model.handleAssets(object);
                this.objectsList.push(object);
                this.write();
            }
        }
        return object;
    }
    update(id, objectToModify) {
        delete objectToModify.Id;
        objectToModify = { Id: id, ...objectToModify };
        this.model.validate(objectToModify);
        if (this.model.state.isValid) {
            let index = this.indexOf(objectToModify.Id);
            if (index > -1) {
                this.checkConflict(objectToModify);
                if (!this.model.state.inConflict) {
                    this.model.handleAssets(objectToModify, this.objectsList[index]);
                    this.objectsList[index] = objectToModify;
                    this.write();
                }
            } else {
                this.model.addError(`The ressource [${objectToModify.Id}] does not exist.`);
                this.model.state.notFound = true;
            }
        }
        return objectToModify;
    }
    remove(id) {
        let index = 0;
        for (let object of this.objects()) {
            if (object.Id === id) {
                this.model.removeAssets(object)
                this.objectsList.splice(index, 1);
                this.write();
                return true;
            }
            index++;
        }
        return false;
    }
    getAll(params = null) {
        // Todo Labo 4
        let collectionFilter = new CollectionFilter(this.objects(), params, this.model);
        //let objectsList = collectionFilter.get();
        let objectsList = this.objects();
        let bindedDatas = [];
        if (objectsList)
            for (let data of objectsList) {


                bindedDatas.push(this.model.bindExtraData(data));
            };
        return bindedDatas;
    }
    get(id) {
        for (let object of this.objects()) {
            if (object.Id === id) {
                return this.model.bindExtraData(object);
            }
        }
        return null;
    }
    removeByIndex(indexToDelete) {
        if (indexToDelete.length > 0) {
            utilities.deleteByIndex(this.objects(), indexToDelete);
            this.write();
        }
    }
    findByField(fieldName, value, excludedId = 0) {
        if (fieldName) {
            let index = 0;
            for (let object of this.objects()) {
                try {
                    if (object[fieldName] === value) {
                        if (object.Id != excludedId) return this.objectsList[index];
                    }
                    index++;
                } catch (error) { break; }
            }
        }
        return null;
    }
    indexOf(id) {
        let index = 0;
        for (let object of this.objects()) {
            if (object.Id === id) return index;
            index++;
        }
        return -1;
    }
}

class CollectionFilter {
    constructor(data, params, model) {
        this.data = data;
        this.params = params;
        this.model = model;
        this.Filtrer();
    }

    Filtrer() {
        console.log("----------------------------------------------------------------");
        let dataDupe = this.data;
        const sort = this.params.sort ? this.params.sort : undefined;
        const limit = this.params.offset ? this.params.limit : undefined;
        const offset = this.params.offset ? this.params.offset : undefined;
        const field = this.params.field ? this.params.field : undefined;

        delete this.params.sort;
        delete this.params.field;
        delete this.params.limit;
        delete this.params.offset;

        if (sort) {
            this.SortData(sort.split(","));
            if (this.data == null)
                this.data = dataDupe;
            else
                dataDupe = this.data;
        }

        if (Object.keys(this.params).length > 0) {
            this.SortDataByName(this.params);
            if (this.data == null)
                this.data = dataDupe;
            else
                dataDupe = this.data;
        }

        if (field) {
            this.SortByField(field.split(","));
            if (this.data == null)
                this.data = dataDupe;
            else
                dataDupe = this.data;
        }

        if (limit && offset) {
            this.SortDataByLimitAndOffset(limit, offset);
            if (this.data == null) 
                this.data = dataDupe;
            else
                dataDupe = this.data;
        }

        console.log(this.data);
    }

    SortDataByLimitAndOffset(limit, offset) {
        limit = parseInt(limit);
        offset = parseInt(offset);
        try {
            const startIndex = limit * offset;
            const endIndex = Object.keys(this.data).length > startIndex + limit? startIndex + limit: Object.keys(this.data).length;
            //endIndex = Object.keys(this.data).length > endIndex? endIndex : Object.keys(this.data).length; 
            console.log(startIndex);
            console.log(endIndex);
            this.data = this.data.slice(startIndex, endIndex);
        } catch {}
    }

    SortData(sort) {
        const property = sort[0];
        const direction = sort[1];
        let categories = [];
        for (let i = 0; i < Object.keys(this.model.fields).length; i++) {
            categories.push(Object.values(this.model.fields[i])[0]);
        }
        if (categories.includes(property)) {
            this.data.sort((a, b) => {
                const propA = a[property];
                const propB = b[property];

                if (direction === 'asc') {
                    return propA > propB ? 1 : -1;
                } else if (direction === 'desc') {
                    return propA < propB ? 1 : -1;
                }
            });
        }
    }

    SortByField(fields) {
        const newData = this.data.map(item => {
            const tabItem = {};
            fields.forEach(field => {
                try {
                    if (field in item) {
                        tabItem[field] = item[field];
                    }
                } catch { }
            });
            return tabItem;
        });
        this.data = newData;
    }

    SortDataByName(Nom) {
        let newData = this.data;
    
        for (const obj in Nom) {
            try {
                newData = newData.filter(item => {
                    return item[obj] !== undefined && valueMatch(item[obj], Nom[obj]);
                });
            } catch (e) {
                console.log(e);
            }
        }
        this.data = newData;
    }
}

function valueMatch(value, searchValue) {
    try {
        let exp = '^' + searchValue.toLowerCase().replace(/\*/g, '.*') + '$';
        return new RegExp(exp).test(value.toString().toLowerCase());
    }
    catch (error) {
        console.log(error);
        return false;
    }
}
function compareNum(x, y) {
    if (x === y) return 0;
    else if (x < y) return -1;
    return 1;
}
function innerCompare(x, y) {
    if ((typeof x) === 'string')
        return x.localeCompare(y);
    else
        return this.compareNum(x, y);
}
function equal(ox, oy) {
    let equal = true;
    Object.keys(ox).forEach(function (member) {
        if (ox[member] != oy[member]) {
            equal = false;
            return false;
        }
    })
    return equal;
}

