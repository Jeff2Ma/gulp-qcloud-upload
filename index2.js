var fs = require('fs');
var path = require('path');
var colors = require('gulp-util').colors;
var log = require('gulp-util').log;
var through2 = require('through2');
var Moment = require('moment');
var Q = require('q');
var merge = require('lodash.merge');
var cos = require('./sdk/cos');

var qos = require('./qos-node-client/dist/index').default;

module.exports = function (option) {
	option = option || {};
	option = merge({
		appid: option.appid || '',
		secretId: option.secretId || '',
		secretKey: option.secretKey || '',
		bucket: option.bucket || '', // Bucket 名称
		region: option.region || '', // 地区，sh,gz,tj
		prefix: option.prefix || '', // 自定义文件前缀
		overWrite: option.overWrite || false, // 是否覆盖文件
		headers: option.headers || false // 自定义header
	}, option);

	var nowTime = Moment().format('YYMMDDHHmm');
	var existFiles = 0;
	var uploadedFiles = 0;
	var uploadedFail = 0;
	var tasks = [];

	// 创建一个client
	var client = qos.createClient({
		appId: option.appid,
		secretId: option.secretId,
		secretKey: option.secretKey,
		region: option.region,
		bucket: option.bucket
	});

	// 设置header
	function setHeader(fileKey) {
		var authority = client.sign({bucket: option.bucket, fileId: fileKey});
		client.updateStat({ bucket: option.bucket, fileId: fileKey, authority: authority, headers: option.headers }).then(function (res) {
			// console.log('stat: ', res.message);
		}).catch(function (err) {
			// console.error('err: ', err);
		});
	}

	return through2.obj(function (file, enc, next) {
		var that = this;
		if (file._contents === null) return next();

		// 相对路径
		var fileRelative = path.relative(file.base, file.path);

		// 保存在bucket 的前缀，模拟子目录的概念
		var filePrefix = option.prefix;

		// 待上传文件的本地绝对路径
		var filePath = file.path;

		// 保存在bucket 的file key
		var fileKey = path.join(filePrefix, fileRelative);

		var fileID = '/' + fileKey;

		// // 获取到文件字节大小
		// var stats = fs.statSync(filePath);
		// var fileSizeInBytes = stats.size;

		var handler = function () {
			var defer = Q.defer();
/*
			var paramsPutObj = {
				Appid: option.appid,
				SecretId: option.secretId,
				SecretKey: option.secretKey,
				Bucket: option.bucket,
				Region: option.region,
				IfModifiedSince: nowTime,
				Key: fileKey,
				Body: filePath,
				ContentLength: fileSizeInBytes
			};*/
			var statCode;

			// 检测是否已经存在文件
			client.stat({ bucket: option.bucket, fileId: fileID })
			.then(function (res) {
				statCode = res.code;

				return statCode;
				// console.log(statCode)
			})
			.catch(function (err) {
				statCode = err.statusCode;
				return statCode;
				// console.log(err,statCode)
			})
			.then(function (statCode) {

				// console.log(statCode);

				// statCode 为0 表示已经有同名文件上传上去了
				if(statCode===0 && !option.overWrite){
					// console.log('ddddd')
					existFiles++;
					return defer.resolve();
				} else {
					// 如果文件不存在，则上传
					uploadedFiles++;
					client.upload({ localFile: filePath, fileId: fileID }).then(function (res) {
						// console.log('上传成功', res);
						log('Uploading:', colors.green(fileRelative), '→', colors.yellow(fileKey));
						// 上传成功
						setHeader(fileID);
						defer.resolve();
					}).catch(function (err) {
						// console.error('上传文件时报错', err);
						log('Error →', colors.red(fileKey), err.error.Message);
						uploadedFail++;
						defer.reject();
					});
				}

			});



			// console.log(statCode)
			// code = 0 表示存在文件






			/*client.stat({ bucket: option.bucket, fileId: fileID }, function (err, data) {
				// 已经存在的文件
				if (data && !option.overWrite) {
					existFiles++;
					return defer.resolve();
				}
				uploadedFiles++;

				cos.putObject(paramsPutObj, function (err, data) {
					log('Uploading:', colors.green(fileRelative), '→', colors.yellow(fileKey));
					// 上传失败
					if (err) {
						log('Error →', colors.red(fileKey), err.error.Message);
						uploadedFail++;
						defer.reject();
					}
					// 上传成功
					setHeader(fileKey);
					defer.resolve();
				});
			});*/
			return defer.promise;
		};
		tasks.push(handler());
		next();
	}, function () {
		Q.allSettled(tasks)
			.then(function (fulfilled) {
				log('Total:', colors.green(fulfilled.length),
					'Skip:', colors.gray(existFiles),
					'Success:', colors.green(uploadedFiles - uploadedFail),
					'Failed:', colors.red(uploadedFail));
			}, function (err) {
				log('Failed upload files:', err.message);
			});
	});
};
