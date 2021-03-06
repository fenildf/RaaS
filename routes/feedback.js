// Using native mongodb driver for node.js
var ObjectId = require('mongodb').ObjectID;

// ------------------------------------------------
var db;
var clln;
var BETA = 0.50;
var dyBeta= {
	"office":0.75,
	"office2013":0.75,
	"office365":0.75,
	"Microsoft-Office-Student-1User-Download":0.75,
	"Microsoft-Office-Business-1User-Download":0.75,
	"Microsoft-Office-Professional-1User-Download":0.75,
	"Office-Home-Macs-Card-Disc":0.75,
	"Office-365-Personal-Subscription-Card":0.75,
	"Microsoft-Office-Small-Business-Premium":0.75,
	"Microsoft-University-Subscription-Validation-Required":0.75
};

var IS_REP_TV = true;

var NO_CRED = 0;
var NO_TV_CRED = 1;
var ALL_CRED = 2;

var mode;
//--------------------- helper methods

// it assumes that connection has been established
function getJsonObjectByNameFromDB(clln, name, cb){
	var myCursor = clln.find({"name":name});
	myCursor.limit(1);			
	myCursor.each(function(err,result){
		if(err)cb(err);
		else if(result!=null){
			cb(null, result);
		}
	});
}

function getJsonObjectByIdFromDB(clln, id, cb){
	var myCursor = clln.find({_id:new ObjectId(id)});
	myCursor.limit(1);			
	myCursor.each(function(err,result){
		if(err)cb(err);
		else if(result!=null){
			cb(null, result);
		}
	});
}

function updateStepFromStart(clln, ele, callback) {
	// Async task corresponding to a breadth first traversal
	// Read a service , update it's trust votes and own weighted rating
	// and at last append it's children services to the queue
	console.log("in updateStepFromStart ");
	console.log(ele);		
	element_list.push(ele);
	// read the ele from db
	getJsonObjectByNameFromDB( clln, ele, function(err, result){
		if(err)callback(err);
		else{
			// get its json obj
			
			var s_obj= result;
			console.log(s_obj);
			var s_t_votes= 0;
			var s_owr=0;
			var s_relevance= s_obj[KEY_CRe];
			
			var s_cred_t_votes=0;

			var s_reviewer_rankings = s_obj[KEY_RR];

			// TODO:	it's better to process these in batches or some units of feedback
			// otherwise the code will be a blocking code

			for(var i=0; i<s_relevance.length;i++){
				s_t_votes+=s_relevance[i];
			}

			if(s_reviewer_rankings != undefined){
				for(var i=0; i<s_relevance.length;i++){
					s_cred_t_votes+=(s_relevance[i] * s_reviewer_rankings[i]);
				}
			}

			var s_ratings=s_obj[KEY_CRa];
			

			
			
		

			if(s_reviewer_rankings != undefined && (mode == NO_TV_CRED || mode == ALL_CRED)){
				for(var i=0; i<s_ratings.length;i++){
					s_owr+=(s_ratings[i]*s_relevance[i]*s_reviewer_rankings[i]);
				}
				if(s_cred_t_votes!=0) s_owr/=s_cred_t_votes;
			}
			else{
				for(var i=0; i<s_ratings.length;i++){
					s_owr+=(s_ratings[i]*s_relevance[i]);
				}
				if(s_t_votes!=0) s_owr/=s_t_votes;
			}

			console.log("s_cred_t_votes is ", s_cred_t_votes);
			console.log("s_t_votes is ", s_t_votes);
			console.log("s_owr is ",s_owr);
			
			if(ALL_CRED){
				s_t_votes = s_cred_t_votes;
			}

			// update the local children, owr, tv object
			services_children[s_obj[KEY_NAME]]= s_obj[KEY_CHILDREN];
			services_owr[s_obj[KEY_NAME]]= s_owr;
			services_tv[s_obj[KEY_NAME]]= s_t_votes;

			services_cred_tv[s_obj[KEY_NAME]]= s_cred_t_votes;
			

			
			// update the local siblings object
			var s_parent = s_obj[KEY_PARENT];
			var s_parent_children;
			var s_siblings=[];
			if(s_parent.length!=0){
				s_parent_children=services_children[s_parent[0]]; // only one parent
				if(s_parent_children!==undefined){
					for(var i=0; i<s_parent_children.length; i++){
						if(s_parent_children[i][KEY_CHILDREN_NAME]!=s_obj[KEY_NAME]){
							s_siblings.push(s_parent_children[i][KEY_CHILDREN_NAME]);
						}
					}
				}
			}
			
			// loop for it's children and push them into the queue
			var s_children = s_obj[KEY_CHILDREN];
			var s_num_children= s_children.length;
			
			for(var i=0; i<s_num_children; i++){
				var s_child = s_children[i];
				queue.push(s_child[KEY_CHILDREN_NAME]);
			}
			
			services_siblings[s_obj[KEY_NAME]]= s_siblings;
			
			// update tx and r(x)
			clln.update(
				{"name":ele}, 
				{
					$set:{
						"own_wmean_rating":s_owr,
						"trust_votes":s_t_votes,
						"consumer_feedback_count":s_relevance.length
					}
				},
				function (err, numUpdated){
					if(err)callback(err);
					else if (numUpdated!=0){
						callback(null, numUpdated); 
					}
				}
			);
			
			
		}
	});
}

function uwrCalcStep(clln, ele, callback) {
	// Update the value of Universe Weighted Mean 
	// Rating U(x) , for the node/service element 'ele'
	// And also calculate the value of the	U(x) for it's children 
	// and save it for use by them during the traversal
	console.log("uwr calc step for : ",ele);
	var s_uwr=0;
	var s_name = ele;
	var s_uwr_children=0;
	
	// If the node is root then U(x) = R(x)
	// i.e, Universe Weighted Mean Rating is equal to
	// Own Weighted Mean Rating for the node
	// Otherwise get it from the services_uwr object
	
	if(s_name===service_root){
		s_uwr=services_owr[s_name];
		services_uwr[s_name]=s_uwr;
		
	}
	else {
		s_uwr= services_uwr[s_name];
		console.log('\n s_uwr from the services array is \n');
		console.log(s_uwr);
	}
	// Calculation of UWR for the child nodes 
	// UWR involves the contribution from the siblings 
	// with weight as gamma1 and from the cousins
	// with weight gamma2
	
	var siblings_ra_re=0;
	var siblings_tv=0;
	var cousins_ra_re=0;
	var cousins_tv=0;
	var s_children=[];
	var s_siblings=services_siblings[s_name];
	
	// The services_children array has children elements as json objects 
	// with name and edge weight as the keys 
	
	for(var i=0; i<services_children[s_name].length; i++){
		s_children.push(services_children[s_name][i][KEY_CHILDREN_NAME]);
	}
	
	console.log("s_siblings ",s_siblings);
	console.log("s_children ", s_children, '\n');
	
	if(s_children.length!=0){
		if(s_siblings.length!=0){
			for(var i=0; i<s_siblings.length; i++){
				
				// for the cousin: s_sibling[i] , find the contribution due to it's children
				var cousin_children= [];
				
				for(var j=0; j<services_children[s_siblings[i]].length; j++){
					cousin_children.push(services_children[s_siblings[i]][j][KEY_CHILDREN_NAME]);
				}
				
				console.log("cousin_children ",cousin_children); 
				if(cousin_children.length!=0){

					for (var j=0; j<cousin_children.length; j++){
						if(mode == NO_CRED){
							cousins_ra_re+= (services_owr[cousin_children[j]]*services_tv[cousin_children[j]]);
							cousins_tv+= services_tv[cousin_children[j]];
						}
						else{
							cousins_ra_re+= (services_owr[cousin_children[j]]*services_cred_tv[cousin_children[j]]);
							cousins_tv+= services_cred_tv[cousin_children[j]];
						}
					}
				}
			}
		}
		// The contribution from the children of the current 'ele' (node)
		// i.e. the siblings 
		for(var i=0; i<s_children.length; i++){
			console.log("services owr ",services_owr[s_children[i]]);
			console.log("services tv ",services_tv[s_children[i]]);
			if(mode == NO_CRED){
				siblings_ra_re+= (services_owr[s_children[i]]*services_tv[s_children[i]]);
				siblings_tv+= services_tv[s_children[i]];
			}
			else{
				siblings_ra_re+= (services_owr[s_children[i]]*services_cred_tv[s_children[i]]);
				siblings_tv+= services_cred_tv[s_children[i]];
			}
		}

		console.log("siblings_ra_re : ", siblings_ra_re);
		console.log("siblings_tv : ", siblings_tv);
		
		// Combining the contribution with appropriate weights
		s_uwr_children= ( (gamma1*siblings_ra_re) +(gamma2*cousins_ra_re));
		if(((gamma1*siblings_tv) +(gamma2*cousins_tv))!==0){
			s_uwr_children/= ( (gamma1*siblings_tv) +(gamma2*cousins_tv));
		}
		console.log("s_uwr_children is : \n"); 
		console.log(s_uwr_children);
		
		for(var i=0; i<s_children.length; i++){
			services_uwr[s_children[i]]=s_uwr_children;
		} 
	}
	else {
		console.log("it has no children");
	}
	
	// Update UWR of the current service element(node) in the database
	clln.update(
		{"name":ele}, 
		{
			$set:{
				"universe_wmean_rating":s_uwr,
			}
		},
		function (err, numUpdated){
			if(err)callback(err);
			else if (numUpdated!=0){
				console.log("updating uwr values ");
				callback(null, numUpdated); 
			}
		}
	);
	
}

function remainingScoresCalcStep(clln, ele, callback) {
	// Used for calculating rtv (trust value of ratings), 
	// crc (child rating contribution), orc (own rating contribution),
	// ars (aggregated rating score)
	
	var s_name = ele;
	var s_uwr=services_uwr[s_name];
	var s_owr=services_owr[s_name];
	var s_tv=services_tv[s_name];
	
	var s_ars=0;
	var s_orc=0;
	var s_crc=0;
	var s_rtv=0;
	var s_crc_num=0;
	var s_crc_denom=0;
	
	// The children array consists of objects with 
	// name and weight as properties
	var s_children=services_children[s_name];
	var s_children_name=[];
	var s_children_wt=[];
	var s_num_children = s_children.length;
	
	for(var i=0; i<s_num_children; i++){
		s_children_name.push(s_children[i][KEY_CHILDREN_NAME]);
		s_children_wt.push(s_children[i][KEY_CHILDREN_WT]);
	}
	
	// B(x)= dyBeta[] * R(x) + (1-dyBeta[]) * U(x)
	//console.log("dynamic beta \n", dyBeta[s_name]);
	//s_orc= ((dyBeta[s_name]*s_owr)+((1-dyBeta[s_name])*s_uwr));
	s_orc= ((BETA*s_owr)+((1-BETA)*s_uwr));
	
	// T(x) = Tx + Summation( T(ci) / 2^d(ci,x) )
	s_rtv= s_tv;
	if(s_num_children!=0){
		for(var i=0; i<s_num_children; i++){
			var s_child_name=s_children_name[i];
			s_rtv+= (services_rtv[s_child_name]/2);
			s_crc_num+= (services_ars[s_child_name]*services_rtv[s_child_name]*s_children_wt[i]);
			s_crc_denom+= (services_rtv[s_child_name]*s_children_wt[i]);
		} 
		
		// C(x)= Summation ( S(ci) * T(ci) * w(x,ci) ) / Summation ( T(ci) * w(x,ci) )
		s_crc= s_crc_num/s_crc_denom;
		
		// S(x) = alpha * B(x) + (1-alpha) * C(x)
		if(s_orc!=0){
			s_ars= (alpha*s_orc) + ((1-alpha)*s_crc);
		}
		else {
			s_ars=s_crc;
		}
	}
	else {
		s_ars=s_orc;
	}
	
	services_ars[s_name]=s_ars;
	services_rtv[s_name]=s_rtv;	
	
	clln.update(
		{"name":ele}, 
		{
			$set:{
				"agg_rating_score":s_ars,
				"own_rating_cont":s_orc,
				"children_rating_cont":s_crc,
				"rating_trust_value":s_rtv

			}
		},
		function (err, numUpdated){
			if(err)callback(err);
			else if (numUpdated!=0){
				console.log("updating uwr values ");
				callback(null, numUpdated); 
			}
		}
	);
	
}


// Final task after traversal is done
function onBFTraversalComplete(cb) { 
	cb(null,'Done updating'); 
}

// A general async traversal for traversing the service tree 
// in a breadth-first manner
function bfTraversal(clln, element, traversalStep, cb) {
  if(element) {
	traversalStep( clln, element, function(err, result) {
	  if(err){
		cb(err);
	  }
	  else if (result!=null){
		  console.log( "Records updated : ", result);
		  return bfTraversal(clln, queue.shift(),traversalStep, cb);
	  }
	});
  } else {
	return onBFTraversalComplete(cb);
  }
}

// Updating the tv and owr with an appropriate
// traversal step passed as parameter which 
// can be used for updating with recent feedback or 
// feedback from start			
function updateTvAndOwr(clln, updateTvAndOwrStep, cb){
	
	console.log(" In function updateTvAndOwr : now finding one doc \n\n");
			
	getJsonObjectByNameFromDB(clln, "meta",  function (err, result){
		if(err)cb(err);
		else if (result!=null){
			service_root = result.root;
			console.log("the root is ", service_root);
			console.log("\n the metadata is \n");					
			console.log(result);
			
			// ELement list saves the order in which traversal proceeds 
			// which can be utilised the next time you have to traverse the tree
			element_list=[];
			queue=[];
			queue.push(service_root);
			bfTraversal(clln, queue.shift(), updateTvAndOwrStep, function(err, result){
				if(err)cb(err);
				else if(result!=null){
					cb(null,result);
				}
			});
			
			// TODO: Also check out that keys are not working when used in form of constants
			
		}
	});
}

function updateStepFromNewFeedback(clln, ele, callback) {
	
	// Update element list since new elments may have been added 
	element_list.push(ele);
	
	console.log("in updateStepFromNewFeedback\n\n");
	// get data from redis cache 
	// for now suppose that the it is in the format
	// as specified by the file new_feedback.js
	
	console.log(ele); 
	var s_new_obj= redis_data[ele];
	var s_new_relevance=[];
	var s_new_ratings=[];
	var s_new_owr=0;
	var s_old_owr=0;
	var s_owr=0;
	var s_new_t_votes= 0;
	var s_old_t_votes=0;
	var s_t_votes=0;
	var s_new_feedback_ct=0;
	// Calculate the new tv (Trust Votes) and
	// owr (Own Weighted Mean Rating) if only new ratings 
	// have been given to this ele
		
	if(s_new_obj!=undefined){
		console.log(s_new_obj);
		s_new_relevance= s_new_obj[KEY_CRe];
		console.log(s_new_relevance);
		// TODO:it's better to process these in batches or some units of feedback
		// otherwise the code will be a blocking code
		// 
		for(var i=0; i<s_new_relevance.length;i++){
			s_new_t_votes+=s_new_relevance[i];
		}
		s_new_ratings=s_new_obj[KEY_CRa];

		for(var i=0; i<s_new_ratings.length;i++){
			s_new_owr+=(s_new_ratings[i]*s_new_relevance[i]);
		}
		s_new_feedback_ct+= s_new_relevance.length;
	}
	s_old_t_votes=services_tv[ele];
	s_t_votes= s_new_t_votes+s_old_t_votes;
	s_old_owr=services_owr[ele]*services_tv[ele];
	s_owr= s_new_owr+s_old_owr;
	
	// Check s_t_votes for not equal to zero before dividing by it
	if(s_t_votes!=0) s_owr/=s_t_votes;
	
	console.log("s_t_votes is ", s_t_votes);
	console.log("s_owr is ",s_owr);
	
	
	services_owr[ele]= s_owr;
	services_tv[ele]= s_t_votes;
	
	
	// loop for it's children and push them into the queue
	var s_children = services_children[ele];
	var s_num_children= s_children.length;
	
	for(var i=0; i<s_num_children; i++){
		var s_child = s_children[i];
		queue.push(s_child[KEY_CHILDREN_NAME]);
	}
	
	// update tx and r(x)
	clln.update(
		{"name":ele}, 
		{
			$set:{
				
				"own_wmean_rating":s_owr,
				"trust_votes":s_t_votes,
				"consumer_ratings":s_new_ratings,
				"consumer_relevance":s_new_relevance
			},
			$inc:{
				"consumer_feedback_count":s_new_feedback_ct
			}
		},
		function (err, numUpdated){
			if(err)callback(err);
			else if (numUpdated!=0){
				callback(null, numUpdated); 
			}
		}
	);
	
	
}



function updateUWR(clln, cb){
	console.log('In function updateOtherScores: ');
	console.log(element_list);
	console.log(services_children);
	console.log(services_siblings);
	console.log(services_owr);
	console.log(services_tv);
	queue=[];
	for(var i=0; i<element_list.length; i++){
		queue.push(element_list[i]);
	}
	console.log(queue);
	bfTraversal(clln, queue.shift(), uwrCalcStep, function (err,result){
		if(err)cb(err);
		else if(result!=null){
			//cb(result);
			// update other scores - initialise queue and define another traversal step for that
			cb(null, 'UWR scores are updated');
		}
	});	
	
	
}

function updateRemainingScores(clln, cb){
	console.log('In function updateRemainingScores: ');
	
	// Now traversal will be done from bottom to up
	
	queue=[];
	for(var i=element_list.length-1; i>=0; i--){
		queue.push(element_list[i]);
	}
	console.log(queue);
	
	bfTraversal(clln, queue.shift(), remainingScoresCalcStep, function (err,result){
		if(err)cb(err);
		else if(result!=null){
			console.log("Updated remaning ratings for the tree");
			//cb(result);
			// update other scores - initialise queue and define another traversal step for that
			cb(null, 'other scores are updated');
		}
	});	
	
	
}

// Used for aggregating the feedback and calculating scores 
// from the start or for the recent incoming feedbacks

function aggregateFeedback(clln, updateTvAndOwrStep, cb){
	console.log('In function aggregateFeedback: ');
	updateTvAndOwr(clln, updateTvAndOwrStep, function(err, result){
		if(err)cb(err);
		else if (result!=null){
			
			console.log(result);
			
			updateUWR(clln, function(err, result){
				if(err)cb(err);
				else if (result!=null){
					console.log(result);
					
					updateRemainingScores(clln, function (err, result){
						if (err)cb(err);
						else if (result!=null){
							console.log("Remaining scores also updated");
							cb(null, result);
						}
					});
				}
			});
				
		}
	});
}

exports.getFeedbackById= function( req, res ){
	db = req.db;
	clln = db.collection(CLLN_NAME);
	var reqId = req.params.id;
	var reqName;
	for (var property in services_id) {
		if (services_id.hasOwnProperty(property)) {
			if(services_id[property]==reqId){
				reqName=""+ property;
				break;
			}
		}
	}
	mode = NO_CRED;
	aggregateFeedback(clln, updateStepFromStart, function(err, result){
		if(err) res.send("there was an error in aggregating feedback"+err);
		else if (result!=null){
			res.send(
					"Aggregated feedback is "
					+"\n" + "ARS: "+services_ars[reqName] 
					+"\n" + "OWR: "+services_owr[reqName]
					+ "\n" +"UWR: "+services_uwr[reqName]
					+ "\n" + "RTV: "+services_rtv[reqName]
					+ "\n" + "TV: "+services_tv[reqName]
			);
		}
	});
}

exports.getCompleteFeedback = function (req, res){
	db = req.db;
	clln = db.collection(CLLN_NAME);
	aggregateFeedback(clln, updateStepFromStart, function(err, result){
		if(err) res.send("there was an error in aggregating feedback"+err);
		else if (result!=null){
			res.send("feedback aggregated successfully" +result);
		}
	});
}

exports.getRawAverageFeedback = function(req, res){

	db = req.db;
	clln = db.collection(CLLN_NAME);
	
	var result ="";
	var cursor = clln.find({});

	cursor.each(function(err, item){
		
		if(err || item == null){
			console.log(err);
			db.close();
			console.log("fukc uou");
			res.send(result);
		}
		else{

			if(item.hasOwnProperty(KEY_CRa) && item[KEY_CRa].length>0){
				var ratings = item[KEY_CRa];
				var sum = 0;
				for(var j=0; j<ratings.length; j++){
					sum+= ratings[j];
				}
				console.log("sum is "+ sum);
				sum/= ratings.length;
				console.log(ratings.length);
				result+= item[KEY_NAME] + "\t" + sum +"\n";
			}
			else{  

			}
		}
	});
	
  	
}

exports.getARS = function(req, res){

	db = req.db;
	clln = db.collection(CLLN_NAME);
	
	var result ="";
	var cursor = clln.find({});

	cursor.each(function(err, item){
		
		if(err || item == null){
			console.log(err);
			db.close();
			console.log("fukc uou");
  			res.send(result);
		}
		else{

			if(item.hasOwnProperty(KEY_ARS)){
				result+= item[KEY_NAME] + "\t" + item[KEY_ARS] +"\n";
			}
		}
	});
	
}

exports.getFeedbackCount = function(req, res){

	db = req.db;
	clln = db.collection(CLLN_NAME);
	
	var result ="";
	var cursor = clln.find({});

	cursor.each(function(err, item){
		
		if(err || item == null){
			console.log(err);
			db.close();
			console.log("fukc uou");
  			res.send(result);
		}
		else{

			if(item.hasOwnProperty(KEY_CFCt)){
				result+= item[KEY_NAME] + "\t" + item[KEY_CFCt] +"\n";
			}
		}
	});
}