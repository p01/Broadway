var Video = (function() {
    function constructor() {
    }
    return constructor;
})();

/**
 * Represents a video decoder capturing all of its internal state. 
 */
var Decoder = (function() {
    function constructor() {
        this.SequenceParameterSets = [];
        this.PictureParameterSets = [];
        this.Video = new Video();
    }

    constructor.prototype = {
        decode : function(ptr) {
            var reader = new AnnexBNALUnitReader(ptr);

            var i = 0;
            do {
                var nal = reader.readNALUnit();
                if (nal != null) {
                    traceln("+ NAL Unit " + (i++));
                    var unit = nal.createUnit();
                    traceln("| nal_size: " + (nal.rbsp.length + 1));
                    traceln("| nal_type: " + nal.nal_type);
                    traceln("| nal_ref_idc: " + nal.nal_ref_idc);
                    if (unit != null) {
                        unit.decode(new Bitstream(nal.rbsp));
                        // println(unit.toString());
                    }
                }
            } while (nal != null);
        }
    };

    return constructor;
})();


/*
 * Represents an Annex B (B) byte stream that encodes NAL Units. In the Annex B
 * byte stream NAL Units are prefixed by a 3 byte start code prefix. The actual
 * NAL Unit payload data is interleaved with 'emulation prevention' bytes.
 */
var AnnexBNALUnitReader = (function () {
	var ptr = null;
	
    function constructor(ptr) {
        this.ptr = ptr;
    }

	constructor.prototype = {

        readNALUnit : function() {
            if (this.ptr == null) {
                return null;
            }
            var res = this.findNextAnnexBNALUnit(this.ptr);
            this.ptr = res.next;
            return new NALUnit(res.nal);
        },

        /*
         * Finds the next NAL unit from an Annex B byte stream.
         */
        findNextAnnexBNALUnit : function findNextAnnexBNALUnit(ptr) {
            var i = 0, size = ptr.length;

            /* look for start_code_prefix */
            while (ptr[i] == 0 && i < size) {
                i += 1;
            }
            if (i >= size) {
                error("cannot find any start_code_prefix");
            } else if (ptr[i] != 0x1) {
                /* start_code_prefix is not at the beginning, continue */
                i = -1;
            }
            i++;
            var j = i, start = i, end = start, foundStartCode = 0;
            while (!foundStartCode) {
                /* see 2 consecutive zero bytes */
                while ((j + 1 < size) && (ptr[j] != 0 || ptr[j + 1] != 0)) { 
                    j += 1;
                }
                end = j; /* stop and check for start code */
                /* keep reading for zero byte */
                while (j + 2 < size && ptr[j + 2] == 0) {
                    j += 1;
                }
                if (j + 2 >= size) {
                    size -= start;
                    return {
                        start : start,
                        nal : ptr.subarray(start, start + size),
                        next : null
                    };
                }
                if (ptr[j + 2] == 0x1) {
                    foundStartCode = 1;
                } else {
                    /* could be emulation code 0x3 */
                    j += 2; /* continue the search */
                }
            }
            size = end - start;
            return {
                start : start,
                nal : ptr.subarray(start, start + size),
                next : ptr.subarray(end)
            };
        }
    };

    return constructor;
})();

/**
 * Indicates the type of the NAL Unit. The decoder needs to know how slices are coded. Some information can change from
 * slice to slice and can be encoded in each slice. Other information such as coding parameters, picture format, size,
 * type of entropy coder, bit rate, etc. does not change as often and does not need to be retransmitted as often.
 * 
 * Combinations of coding parameters are stored on both the encoder and decoder side in various tables.
 * 
 * There are two parameter sets: Picture Parameter Set (PPS) contains information about the slices of one or more
 * pictures. Sequence Parameter Set (SPS) contains information about the sequence.
 * 
 * Instantaneous Decoding Refresh (IDR) picture contains only slices with I and SI slice types. IDR pictures invalidate
 * all reference pictures in the buffer prior to itself and can thus confine drifting errors. IDR pictures are always
 * the first in a sequence of pictures.
 * 
 * Baseline Profile and Main Profile does not include NAL Unit Types: 2, 3, 4.
 */
NALU_TYPE = {
    SLICE : 1,
    DPA : 2,
    DPB : 3,
    DPC : 4,
    IDR : 5,
    SEI : 6,
    
    /**
     * Sequence Parameter Set
     */
    SPS : 7,
    
    /**
     * Picture Parameter Set
     */
    PPS : 8,
    
    /**
     * Access Unit Delimiter
     */
    AUD : 9,
    EOSEQ : 10,
    EOSTREAM : 11,
    FILL : 12,
    PREFIX : 14,
    SUB_SPS : 15,
    SLC_EXT : 20,
    VDRD : 24
};

/**
 * Indicates the importance of the NAL Unit for the reconstruction process. The higher the value the more important the
 * NAL Unit. For instance, a value of 0 indicates that the NAL Unit is not used as a reference by any other units can be
 * safely DISCARDED.
 */
NALU_REF_IDC = {
    NALU_PRIORITY_HIGHEST : 3,
    NALU_PRIORITY_HIGH : 2,
    NALU_PRIORITY_LOW : 1,
    NALU_PRIORITY_DISPOSABLE : 0
};

SLICE_TYPE = {
    /**
     * Intra prediction (I) and/or prediction from one reference per macroblock partition (P).
     */
    P_SLICE : 0,
    
    /**
     * Intra prediction (I), prediction from one reference frame (P) or biprediction from two references (B).
     */
    B_SLICE : 1,
    
    /** Intra prediction only. */
    I_SLICE : 2,
    SP_SLICE : 3,
    SI_SLICE : 4,
    P_ALL_SLICE : 5,
    B_ALL_SLICE : 6,
    I_ALL_SLICE : 7,
    SP_ALL_SLICE : 8,
    SI_ALL_SLICE : 9
};

/**
 * Represents a NAL (Network Abstraction Layer) Unit
 * 
 * NAL Unit Header Format:
 * 
 * forbidden_zero_bit (F): Usually set to 0 at source, set to 1 to indicate
 * errors in the NAL Unit.
 * 
 * nal_ref_idc (NRI): Indicates the importance of the NAL Unit, from 0 (low) to
 * 3 (high).
 * 
 * nal_unit_type (TYPE): Indicates the type of the NAL Unit. Although this field
 * encodes 32 possible values, only 12 are used by H.264.
 * 
 * Payload: A buffer that contains an encapsulated byte sequence payload (EBSP)
 * which needs to be decoded to a raw byte sequence payload (RBSP) before
 * further processing.
 * 
 *  <1> <-2-> <-----5-----> <--------- ? ---------> 
 * +---+-----+-------------+-----------------------+ | F | NRI | TYPE | Payload |
 * +---+-----+-------------+-----------------------+
 */
var NALUnit = (function () {
	function constructor(ptr) {
		var forbidden_zero_bit;
		if (ptr.length == 0) {
			unexpected();
		} else {
	        forbidden_zero_bit = ptr[0] >> 7;
	        if (forbidden_zero_bit != 0) {
	        	unexpected();
	        }
	        this.nal_ref_idc = (ptr[0] & 0x60) >> 5;
	        this.nal_type = ptr[0] & 0x1F;
	        this.rbsp = ptr.subarray(1, 1 + convertEBSPToRBSP(ptr.subarray(1)));
	        return;
	    }
	}
	
	/**
	 * Converts an encapsulated byte sequence payload (EBSP) to a raw byte sequence payload (RBSP).
	 */
    function convertEBSPToRBSP(ptr) {
        var j = 0;
        var count = 0;
        var size = ptr.length;
        for (var i = 0; i < size; i++) {
            var x = ptr[i];
            if (count == 2 && x == 0x03) {
                i += 1;
                count = 0;
            }
            ptr[j++] = x;
            if (x == 0x00) {
                count += 1;
            } else {
                count = 0;
            }
        }
        return j;
    }

	constructor.prototype = {
        toString : function toString() {
            return getProperties(this);
        },
        createUnit : function() {
            switch (this.nal_type) {
            case NALU_TYPE.SPS:
                return new SPS();
            case NALU_TYPE.PPS:
                return new PPS();
            case NALU_TYPE.SLICE:
            case NALU_TYPE.IDR:
                return new Slice(this.nal_type);
            default:
                return null;
                // unexpected();
            }
        }
    };
	
	return constructor;
})();




var Slice = (function() {
    function constructor(nal_unit_type) {
        this.nal_unit_type = nal_unit_type;
        this.header = new SliceHeader();
        this.data = new SliceData(this.header);
    }
    
    constructor.prototype.decode = function (stream) {
        var header = this.header;
        var video = decoder.video;
        
        header.decode(this.nal_unit_type, stream);
        
        if (this.nal_unit_type == NALU_TYPE.IDR) {
            // video.prevFrameNumber = 0;
        }
        
        // this.data.decode(stream);
    };
    
    constructor.prototype.toString = function () {
        return "Slice: " + getProperties(this, true);
    };
    
    return constructor;
})();

/**
 * Represents a Slice's Data
 */
var SliceData = (function() {
    function constructor(header) {
        this.header = header;
    }
    
    constructor.prototype.decode = function (stream) {
        
    };
    
    constructor.prototype.toString = function () {
        return "Slice Data: " + getProperties(this, true);
    };
    
    return constructor;
})();

    
/**
 * Represents a Slice Header
 * 
 * Clause 7.4.3
 */
var SliceHeader = (function() {
    function constructor() { }
    
    constructor.prototype.decode = function (nal_unit_type, stream) {
        var video = decoder.Video;
        
        traceln("| + Slice Header");
        this.first_mb_in_slice = stream.uev();
        traceln("| | first_mb_in_slice: " + this.first_mb_in_slice);
        this.slice_type = stream.uev();
        traceln("| | slice_type: " + this.slice_type);
        if (this.first_mb_in_slice != 0) {
            notImplemented();
        }
        this.pic_parameter_set_id = stream.uev();
        traceln("| | pic_parameter_set_id: " + this.pic_parameter_set_id);
        assertRange(this.pic_parameter_set_id, 0, 255);
        
        var currentPPS = video.CurrentPPS = decoder.PictureParameterSets[this.pic_parameter_set_id];
        if (currentPPS == null) {
            unexpected("pic_parameter_set_id: " + this.pic_parameter_set_id);
        }
        
        var currentSPS = video.CurrentSPS = decoder.SequenceParameterSets[currentPPS.seq_parameter_set_id];
        if (currentSPS == null) {
            unexpected();
        }
        
        if (video.CurrentPPS !== currentPPS) {
            video.CurrentPPS = currentPPS;  
            
//            notImplemented("currentPPS.seq_parameter_set_id: " + currentPPS.seq_parameter_set_id +
//                           " != decoder.Video.seq_parameter_set_id: " + decoder.Video.seq_parameter_set_id);
        }
        
        /* derived variables from SPS */
        video.MaxFrameNum = 1 << (currentSPS.log2_max_frame_num_minus4 + 4);
        // MC_OPTIMIZE
        video.PicWidthInMbs = currentSPS.pic_width_in_mbs_minus1 + 1;
        video.PicWidthInSamplesL = video.PicWidthInMbs * 16;
        video.PicWidthInSamplesC = video.PicWidthInMbs * 8;
        video.PicHeightInMapUnits = currentSPS.pic_height_in_map_units_minus1 + 1;
        video.PicSizeInMapUnits = video.PicWidthInMbs * video.PicHeightInMapUnits;
        video.FrameHeightInMbs = (2 - currentSPS.frame_mbs_only_flag) * video.PicHeightInMapUnits;

        /* derived from PPS */
        video.SliceGroupChangeRate = currentPPS.slice_group_change_rate_minus1 + 1;

        this.frame_num = stream.readBits(currentSPS.log2_max_frame_num_minus4 + 4);
        traceln("| | frame_num: " + this.frame_num);
        
        /* Book 5.3.4, if the frame_mbs_only_flag is set to zero, special coding of fields or interlaced video
         * is enabled. */
        if (!currentSPS.frame_mbs_only_flag) {
            /* Clause 7.4.3, a field_pic_flag set to zero indicates the slice is a coded frame, otherwise it's
             * a coded field. We don't support interlaced video. */ 
            this.field_pic_flag = stream.readBit();
            traceln("| | field_pic_flag: " + this.field_pic_flag);
            assertFalse (this.field_pic_flag);
        }
        
        /* derived variables from slice header */
        video.PicHeightInMbs = video.FrameHeightInMbs;
        video.PicHeightInSamplesL = video.PicHeightInMbs * 16;
        video.PicHeightInSamplesC = video.PicHeightInMbs * 8;
        video.PicSizeInMbs = video.PicWidthInMbs * video.PicHeightInMbs;
        
        if (this.first_mb_in_slice >= video.PicSizeInMbs) {
            unexpected();
        }
        video.MaxPicNum = video.MaxFrameNum;
        video.CurrPicNum = this.frame_num;

        if (nal_unit_type == NALU_TYPE.IDR) {
            if (this.frame_num != 0) {
                unexpected();
            }
            this.idr_pic_id = stream.uev();
            traceln("| | idr_pic_id: " + this.idr_pic_id);
        }
        
        this.delta_pic_order_cnt_bottom = 0; /* default value */
        this.delta_pic_order_cnt = [0, 0];
        
        if (currentSPS.pic_order_cnt_type == 0) {
            this.pic_order_cnt_lsb = stream.readBits(currentSPS.log2_max_pic_order_cnt_lsb_minus4 + 4);
            traceln("| | pic_order_cnt_lsb: " + this.pic_order_cnt_lsb);
            video.MaxPicOrderCntLsb = 1 << (currentSPS.log2_max_pic_order_cnt_lsb_minus4 + 4);
            if (this.pic_order_cnt_lsb > video.MaxPicOrderCntLsb - 1) {
                unexpected();
            }

            if (currentPPS.pic_order_present_flag) {
                notImplemented();
                this.delta_pic_order_cnt_bottom = stream.sev32();
                traceln("| | delta_pic_order_cnt_bottom: " + this.delta_pic_order_cnt_bottom);
            }
        }
        
        if (currentSPS.pic_order_cnt_type == 1 && !currentSPS.delta_pic_order_always_zero_flag) {
            this.delta_pic_order_cnt[0] = stream.sev32();
            traceln("| | delta_pic_order_cnt[0]: " + this.delta_pic_order_cnt[0]);
            if (currentPPS.pic_order_present_flag) {
                this.delta_pic_order_cnt[1] = stream.sev32();
                traceln("| | delta_pic_order_cnt[1]: " + this.delta_pic_order_cnt[1]);
            }
        }

        this.redundant_pic_cnt = 0; /* default value */
        if (currentPPS.redundant_pic_cnt_present_flag) {
            // MC_CHECK
            this.redundant_pic_cnt = stream.uev();
            if (this.redundant_pic_cnt > 127) /* out of range */
                unexpected();

            if (this.redundant_pic_cnt > 0) /* redundant picture */
                unexpected(); /* not supported */
        }
        
        this.num_ref_idx_l0_active_minus1 = currentPPS.num_ref_idx_l0_active_minus1;
        this.num_ref_idx_l1_active_minus1 = currentPPS.num_ref_idx_l1_active_minus1;

        if (this.slice_type == SLICE_TYPE.P_SLICE) {
            this.num_ref_idx_active_override_flag = stream.readBit();
            traceln("| | num_ref_idx_active_override_flag: " + this.num_ref_idx_active_override_flag);
            if (this.num_ref_idx_active_override_flag) {
                this.num_ref_idx_l0_active_minus1 = stream.uev();
                traceln("| | num_ref_idx_l0_active_minus1: " + this.num_ref_idx_l0_active_minus1);
            } else   {
                /* the following condition is not allowed if the flag is zero */
                if ((slice_type == SLICE_TYPE.P_SLICE) && currentPPS.num_ref_idx_l0_active_minus1 > 15) {
                    unexpected(); /* not allowed */
                }
            }
        }

        if (this.num_ref_idx_l0_active_minus1 > 15 || this.num_ref_idx_l1_active_minus1 > 15) {
            unexpected(); /* not allowed */
        }
        
        /* if MbaffFrameFlag =1,
        max value of index is num_ref_idx_l0_active_minus1 for frame MBs and
        2*this.num_ref_idx_l0_active_minus1 + 1 for field MBs */

        this.ref_pic_list_reordering(video, stream);

        if (video.nal_ref_idc) {
            this.dec_ref_pic_marking(video, stream, this);
        }
        
        this.slice_qp_delta = stream.sev();
        traceln("| | slice_qp_delta: " + this.slice_qp_delta);

        video.QPy = 26 + currentPPS.pic_init_qp_minus26 + this.slice_qp_delta;
        if (video.QPy > 51 || video.QPy < 0) {
            video.QPy = clip(0, 51, video.QPy);
        }
        video.QPc = mapQPi2QPc[clip(0, 51, video.QPy + video.CurrentPPS.chroma_qp_index_offset)];

        video.QPy_div_6 = (video.QPy * 43) >>> 8;
        video.QPy_mod_6 = video.QPy - 6 * video.QPy_div_6;

        video.QPc_div_6 = (video.QPc * 43) >>> 8;
        video.QPc_mod_6 = video.QPc - 6 * video.QPc_div_6;

        this.slice_alpha_c0_offset_div2 = 0;
        this.slice_beta_offset_div_2 = 0;
        this.disable_deblocking_filter_idc = 0;
        video.FilterOffsetA = video.FilterOffsetB = 0;

        if (currentPPS.deblocking_filter_control_present_flag) {
            this.disable_deblocking_filter_idc = stream.uev();
            traceln("| | disable_deblocking_filter_idc: " + this.disable_deblocking_filter_idc);
            if (this.disable_deblocking_filter_idc > 2) {
                unexpected(); /* out of range */
            }
            if (this.disable_deblocking_filter_idc != 1) {
                this.slice_alpha_c0_offset_div2 = stream.sev();
                traceln("| | slice_alpha_c0_offset_div2: " + this.slice_alpha_c0_offset_div2);
                if (this.slice_alpha_c0_offset_div2 < -6 || this.slice_alpha_c0_offset_div2 > 6) {
                    unexpected();
                }
                video.FilterOffsetA = this.slice_alpha_c0_offset_div2 << 1;
                this.slice_beta_offset_div_2 = stream.sev();
                traceln("| | slice_beta_offset_div_2: " + this.slice_beta_offset_div_2);
                if (this.slice_beta_offset_div_2 < -6 || this.slice_beta_offset_div_2 > 6) {
                    unexpected();
                }
                video.FilterOffsetB = this.slice_beta_offset_div_2 << 1;
            }
        }

        if (currentPPS.num_slice_groups_minus1 > 0 && 
            currentPPS.slice_group_map_type >= 3 &&
            currentPPS.slice_group_map_type <= 5) {
            /* Ceil(Log2(PicSizeInMapUnits/(float)SliceGroupChangeRate + 1)) */
            temp = video.PicSizeInMapUnits / video.SliceGroupChangeRate;
            if (video.PicSizeInMapUnits % video.SliceGroupChangeRate) {
                temp++;
            }
            i = 0;
            temp++;
            while (temp)
            {
                temp >>= 1;
                i++;
            }
            this.slice_group_change_cycle = stream.readBits(i);
            traceln("| | slice_group_change_cycle: " + this.slice_group_change_cycle);
            video.MapUnitsInSliceGroup0 = min(this.slice_group_change_cycle * video.SliceGroupChangeRate, video.PicSizeInMapUnits);
        }
    };
   
    /**
     * Book 5.3.3.2
     * Clause 7.3.3.1
     * 
     * The reference picture list order can be change for the current slice only using this command. The
     * ref_pic_list_reordering_flag indicates that such an operation should occur.
     */
    constructor.prototype.ref_pic_list_reordering = function(video, stream) {
        if (this.slice_type != SLICE_TYPE.I_SLICE) {
            this.ref_pic_list_reordering_flag_l0 = stream.readBit();
            traceln("| | ref_pic_list_reordering_flag_l0: " + this.ref_pic_list_reordering_flag_l0);
            if (this.ref_pic_list_reordering_flag_l0) {
                traceln("| | + Reference Picture List Reordering Commands");
                var i = 0;
                this.reordering_of_pic_nums_idc_l0 = [];
                this.abs_diff_pic_num_minus1_l0 = [];
                do {
                    var res = this.reordering_of_pic_nums_idc_l0[i] = stream.uev();
                    if (res == 0 || res == 1) {
                        this.abs_diff_pic_num_minus1_l0[i] = stream.uev();
                        traceln("| | abs_diff_pic_num_minus1_l0[" + i + "]: " + this.abs_diff_pic_num_minus1_l0[i]);
                        assertFalse (res == 0 && this.abs_diff_pic_num_minus1_l0[i] > video.MaxPicNum / 2 - 1);
                        assertFalse (res == 1 && this.abs_diff_pic_num_minus1_l0[i] > video.MaxPicNum / 2 - 2);
                    } else if (res == 2) {
                        this.long_term_pic_num_l0[i] = stream.uev();
                        traceln("| | long_term_pic_num_l0[" + i + "]: " + this.long_term_pic_num_l0[i]);
                    }
                    i++;
                } while (this.reordering_of_pic_nums_idc_l0[i - 1] != 3 && i <= this.num_ref_idx_l0_active_minus1 + 1);
            }
        }
    };
    
    /**
     * Clause 7.4.3.3
     */
    constructor.prototype.dec_ref_pic_marking = function(video, stream) {
        traceln("| | + dec_ref_pic_marking");
        if (video.nal_unit_type == NALU_TYPE.IDR) {
            this.no_output_of_prior_pics_flag = stream.readBit();
            traceln("| | | no_output_of_prior_pics_flag: " + this.no_output_of_prior_pics_flag);
            this.long_term_reference_flag = stream.readBit();
            traceln("| | | long_term_reference_flag: " + this.long_term_reference_flag);
            if (this.long_term_reference_flag == 0) {
                video.MaxLongTermFrameIdx = -1;
            } else {
                video.MaxLongTermFrameIdx = 0;
                video.LongTermFrameIdx = 0;
            }
        } else {
            this.adaptive_ref_pic_marking_mode_flag = stream.readBit();
            traceln("| | | adaptive_ref_pic_marking_mode_flag: " + this.adaptive_ref_pic_marking_mode_flag);
            if (this.adaptive_ref_pic_marking_mode_flag) {
                this.memory_management_control_operation = [];
                this.difference_of_pic_nums_minus1 = [];
                this.long_term_pic_num = [];
                this.max_long_term_frame_idx_plus1 = [];
                var i = 0;
                do {
                    var res = this.memory_management_control_operation[i] = stream.uev();
                    traceln("| | | memory_management_control_operation[" + i + "]: " + this.memory_management_control_operation[i]);
                    if (res == 1 || res == 3) {
                        this.difference_of_pic_nums_minus1[i] = stream.uev();
                        traceln("| | | difference_of_pic_nums_minus1[" + i + "]: " + this.difference_of_pic_nums_minus1[i]);
                    }
                    if (res == 2) {
                        this.long_term_pic_num[i] = stream.uev();
                        traceln("| | | long_term_pic_num[" + i + "]: " + this.long_term_pic_num[i]);
                    }
                    if (res == 3 || res == 6) {
                        this.long_term_frame_idx[i] = stream.uev();
                        traceln("| | | long_term_frame_idx[" + i + "]: " + this.long_term_frame_idx[i]);
                    }
                    if (res == 4) {
                        this.max_long_term_frame_idx_plus1[i] = stream.uev();
                        traceln("| | | max_long_term_frame_idx_plus1[" + i + "]: " + this.max_long_term_frame_idx_plus1[i]);
                    }
                    i++;
                } while (this.memory_management_control_operation[i - 1] != 0 && i < MAX_DEC_REF_PIC_MARKING);
                assertFalse(i >= MAX_DEC_REF_PIC_MARKING);
            }
        }
    };
    
    constructor.prototype.toString = function () {
        return "Slice Header: " + getProperties(this, true);
    };
    
    return constructor;
})();




